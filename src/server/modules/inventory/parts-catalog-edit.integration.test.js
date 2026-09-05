import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { createCompanyCatalogPart, updateCompanyCatalogPart } from "../../db/repositories/parts-catalog-edit.repo.js";
import { importOdooInventory } from "../../integrations/odoo/odoo.admin.repo.js";
import { closePool, query } from "../../db/pool.js";

const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === "1";

after(async () => {
  if (runPostgres) await closePool();
});

test("real PostgreSQL creates local catalog identity without stock and protects references", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID();
  const companyId = randomUUID();
  try {
    await query("insert into user_profiles (id, display_name) values ($1, $2)", [actorId, `Part creator ${suffix}`]);
    await query("insert into companies (id, slug, name) values ($1, $2, 'Part creator')", [companyId, `part-creator-${suffix}`]);
    const created = await createCompanyCatalogPart({
      companyId, actorId, description: "Local-only valve", partNumber: `LOCAL-${suffix}`, manufacturer: "Bendix",
      category: "Air", barcode: `BAR-${suffix}`, uomCode: "ea", referenceNumbers: [`ODOO-${suffix}`],
    });
    assert.equal(created.kind, "created");
    assert.equal(created.part.providerManaged, false);
    const persisted = await query(
      `select catalog.source_provider, reference.reference_number,
              (select count(*)::int from inventory_items item where item.company_id=catalog.company_id and item.catalog_part_id=catalog.id) as stock_count,
              (select count(*)::int from odoo_product_mappings mapping where mapping.company_id=catalog.company_id and mapping.catalog_part_id=catalog.id) as mapping_count
       from parts_catalog catalog join part_reference_numbers reference on reference.company_id=catalog.company_id and reference.catalog_part_id=catalog.id
       where catalog.company_id=$1 and catalog.id=$2`,
      [companyId, created.part.id],
    );
    assert.deepEqual(persisted.rows[0], { source_provider: "local", reference_number: `ODOO-${suffix}`, stock_count: 0, mapping_count: 0 });
    await importOdooInventory(companyId, { products: [{
      id: `product-${suffix}`, default_code: `ODOO-${suffix}`, barcode: "", name: "Odoo valve",
      uom_id: [1, "Units"], categ_id: [1, "Parts"], active: true, write_date: "2026-09-05 12:00:00",
    }] });
    const mapped = await query("select catalog_part_id from odoo_product_mappings where company_id=$1 and external_id=$2", [companyId, `product-${suffix}`]);
    assert.equal(mapped.rows[0].catalog_part_id, created.part.id);
    assert.equal((await query("select count(*)::int as count from parts_catalog where company_id=$1", [companyId])).rows[0].count, 1);
    const conflict = await createCompanyCatalogPart({
      companyId, actorId, description: "Duplicate", partNumber: `ODOO-${suffix}`, manufacturer: "", category: "", barcode: "", uomCode: "ea", referenceNumbers: [],
    });
    assert.equal(conflict.kind, "identity_conflict");
  } finally {
    await query("delete from companies where id=$1", [companyId]).catch(() => {});
    await query("delete from user_profiles where id=$1", [actorId]).catch(() => {});
  }
});

test("real PostgreSQL edits local identity atomically and protects tenant and Odoo ownership", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID();
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const locationId = randomUUID();
  const partId = randomUUID();
  const conflictingPartId = randomUUID();
  const providerPartId = randomUUID();
  const unusedPartId = randomUUID();
  const historyPartId = randomUUID();
  const base = {
    actorId,
    companyIds: [companyId],
    description: "Air valve",
    partNumber: `AIR-${suffix}`,
    manufacturer: "Bendix",
    category: "Air",
    barcode: `BAR-${suffix}`,
    uomCode: "ea",
    referenceNumbers: [`BW-${suffix}`],
  };

  try {
    await query("insert into user_profiles (id, display_name) values ($1, $2)", [actorId, `Part editor ${suffix}`]);
    await query(
      "insert into companies (id, slug, name) values ($1, $2, 'Part editor'), ($3, $4, 'Other tenant')",
      [companyId, `part-editor-${suffix}`, otherCompanyId, `part-editor-other-${suffix}`],
    );
    await query("insert into locations (id, company_id, name) values ($1, $2, 'Parts room')", [locationId, companyId]);
    await query(
      `insert into parts_catalog (id, company_id, normalized_part_number, part_number, description, uom_code)
       values ($1, $2, $3, $3, 'Original valve', 'ea'),
              ($4, $2, $5, $5, 'Conflict part', 'ea'),
              ($6, $2, $7, $7, 'Provider part', 'ea'),
              ($8, $2, $9, $9, 'Unused part', 'ea'),
              ($10, $2, $11, $11, 'History part', 'ea')`,
      [partId, companyId, `OLD${suffix}`.toUpperCase(), conflictingPartId, `USED${suffix}`.toUpperCase(), providerPartId, `ODOO${suffix}`.toUpperCase(), unusedPartId, `UNUSED${suffix}`.toUpperCase(), historyPartId, `HISTORY${suffix}`.toUpperCase()],
    );
    await query(
      `insert into inventory_items (
         company_id, location_id, catalog_part_id, normalized_part_number, part_number,
         description, manufacturer, quantity_on_hand, quantity_reserved, uom_code, source_provider
       ) values ($1, $2, $3, $4, $5, 'Original valve', '', 2, 0, 'ea', 'local')`,
      [companyId, locationId, partId, `OLD${suffix}`.toUpperCase(), `OLD-${suffix}`],
    );
    await query(
      "insert into odoo_product_mappings (company_id, external_id, catalog_part_id, default_code, display_name) values ($1, $2, $3, $4, 'Provider part')",
      [companyId, `provider-${suffix}`, providerPartId, `ODOO-${suffix}`],
    );

    const hidden = await updateCompanyCatalogPart({ ...base, catalogPartId: partId, companyIds: [otherCompanyId], expectedVersion: 1 });
    assert.equal(hidden.kind, "not_found");

    const updated = await updateCompanyCatalogPart({ ...base, catalogPartId: partId, expectedVersion: 1 });
    assert.equal(updated.kind, "updated");
    assert.equal(updated.part.version, 2);
    assert.deepEqual(updated.part.referenceNumbers, [`BW-${suffix}`]);
    assert.equal(updated.part.uomLocked, true);
    assert.ok(updated.part.editableFields.includes("uomCode"));

    const projection = await query(
      "select normalized_part_number, part_number, description, manufacturer from inventory_items where company_id = $1 and catalog_part_id = $2",
      [companyId, partId],
    );
    assert.equal(projection.rows[0].part_number, `AIR-${suffix}`);
    assert.equal(projection.rows[0].description, "Air valve");
    assert.equal(projection.rows[0].manufacturer, "Bendix");

    const unusedUpdated = await updateCompanyCatalogPart({
      ...base, catalogPartId: unusedPartId, expectedVersion: 1, partNumber: `UNUSED-${suffix}`,
      barcode: "", uomCode: "qt", referenceNumbers: [],
    });
    assert.equal(unusedUpdated.kind, "updated");
    assert.equal(unusedUpdated.part.uomCode, "qt");
    assert.ok(unusedUpdated.part.editableFields.includes("uomCode"));
    const uomAudit = await query(
      "select before_state, after_state from part_catalog_edit_events where company_id=$1 and catalog_part_id=$2",
      [companyId, unusedPartId],
    );
    assert.equal(uomAudit.rows[0].before_state.uomCode, "ea");
    assert.equal(uomAudit.rows[0].after_state.uomCode, "qt");

    await query(
      `insert into inventory_stock_movements (company_id, location_id, catalog_part_id, movement_type, quantity_delta, uom_code, actor_id, reason, idempotency_key)
       values ($1, $2, $3, 'adjustment', 1, 'ea', $4, 'test history', $5)`,
      [companyId, locationId, historyPartId, actorId, `history-${suffix}`],
    );
    const historyLocked = await updateCompanyCatalogPart({
      ...base, catalogPartId: historyPartId, expectedVersion: 1, partNumber: `HISTORY-${suffix}`,
      barcode: "", uomCode: "qt", referenceNumbers: [],
    });
    assert.equal(historyLocked.kind, "uom_incompatible");

    const conflict = await updateCompanyCatalogPart({ ...base, catalogPartId: partId, expectedVersion: 2, referenceNumbers: [`USED-${suffix}`] });
    assert.equal(conflict.kind, "identity_conflict");

    const concurrent = await Promise.all([
      updateCompanyCatalogPart({ ...base, catalogPartId: partId, expectedVersion: 2, referenceNumbers: [`ONE-${suffix}`] }),
      updateCompanyCatalogPart({ ...base, catalogPartId: partId, expectedVersion: 2, referenceNumbers: [`TWO-${suffix}`] }),
    ]);
    assert.deepEqual(concurrent.map((result) => result.kind).sort(), ["stale", "updated"]);
    const stockLocked = await updateCompanyCatalogPart({
      ...base, catalogPartId: partId, expectedVersion: concurrent.find((result) => result.kind === "updated").part.version, uomCode: "qt",
    });
    assert.equal(stockLocked.kind, "uom_incompatible");

    const providerManaged = await updateCompanyCatalogPart({
      ...base,
      catalogPartId: providerPartId,
      expectedVersion: 1,
      description: "Changed locally",
      partNumber: `ODOO${suffix}`.toUpperCase(),
      category: "",
      barcode: "",
      referenceNumbers: [],
    });
    assert.equal(providerManaged.kind, "updated");
    assert.equal(providerManaged.part.description, "Changed locally");
    assert.equal(providerManaged.part.odooName, "Provider part");
    assert.deepEqual(providerManaged.part.editableFields, ["description", "manufacturer", "uomCode", "referenceNumbers"]);

    const providerIdentityLocked = await updateCompanyCatalogPart({
      ...base,
      catalogPartId: providerPartId,
      expectedVersion: 2,
      description: "Changed locally",
      partNumber: `LOCAL-${suffix}`,
      barcode: "",
      referenceNumbers: [],
    });
    assert.equal(providerIdentityLocked.kind, "provider_managed");

    const providerEnrichment = await updateCompanyCatalogPart({
      ...base,
      catalogPartId: providerPartId,
      expectedVersion: 2,
      description: "Changed locally",
      partNumber: `ODOO${suffix}`.toUpperCase(),
      category: "",
      barcode: "",
      manufacturer: "Local manufacturer note",
      uomCode: "pc",
      referenceNumbers: [`ALT-${suffix}`],
    });
    assert.equal(providerEnrichment.kind, "updated");
    assert.equal(providerEnrichment.part.uomCode, "pc");
    assert.equal(providerEnrichment.part.canonicalUomCode, "ea");
    assert.deepEqual(providerEnrichment.part.editableFields, ["description", "manufacturer", "uomCode", "referenceNumbers"]);
    const providerUnits = await query("select uom_code, inventory_display_uom_code from parts_catalog where id=$1", [providerPartId]);
    assert.deepEqual(providerUnits.rows[0], { uom_code: "ea", inventory_display_uom_code: "pc" });

    const evidence = await query(
      "select count(*)::int as count, min(version_before)::int as first_version from part_catalog_edit_events where company_id = $1",
      [companyId],
    );
    assert.equal(evidence.rows[0].count, 5);
    assert.equal(evidence.rows[0].first_version, 1);
  } finally {
    await query("delete from companies where id in ($1, $2)", [companyId, otherCompanyId]).catch(() => {});
    await query("delete from user_profiles where id = $1", [actorId]).catch(() => {});
  }
});
