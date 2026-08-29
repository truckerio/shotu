import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { updateCompanyCatalogPart } from "../../db/repositories/parts-catalog-edit.repo.js";
import { closePool, query } from "../../db/pool.js";

const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === "1";

after(async () => {
  if (runPostgres) await closePool();
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
  const base = {
    actorId,
    companyIds: [companyId],
    description: "Air valve",
    partNumber: `AIR-${suffix}`,
    manufacturer: "Bendix",
    category: "Air",
    barcode: `BAR-${suffix}`,
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
              ($6, $2, $7, $7, 'Provider part', 'ea')`,
      [partId, companyId, `OLD${suffix}`.toUpperCase(), conflictingPartId, `USED${suffix}`.toUpperCase(), providerPartId, `ODOO${suffix}`.toUpperCase()],
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

    const projection = await query(
      "select normalized_part_number, part_number, description, manufacturer from inventory_items where company_id = $1 and catalog_part_id = $2",
      [companyId, partId],
    );
    assert.equal(projection.rows[0].part_number, `AIR-${suffix}`);
    assert.equal(projection.rows[0].description, "Air valve");
    assert.equal(projection.rows[0].manufacturer, "Bendix");

    const conflict = await updateCompanyCatalogPart({ ...base, catalogPartId: partId, expectedVersion: 2, referenceNumbers: [`USED-${suffix}`] });
    assert.equal(conflict.kind, "identity_conflict");

    const concurrent = await Promise.all([
      updateCompanyCatalogPart({ ...base, catalogPartId: partId, expectedVersion: 2, referenceNumbers: [`ONE-${suffix}`] }),
      updateCompanyCatalogPart({ ...base, catalogPartId: partId, expectedVersion: 2, referenceNumbers: [`TWO-${suffix}`] }),
    ]);
    assert.deepEqual(concurrent.map((result) => result.kind).sort(), ["stale", "updated"]);

    const providerManaged = await updateCompanyCatalogPart({
      ...base,
      catalogPartId: providerPartId,
      expectedVersion: 1,
      description: "Changed locally",
      partNumber: `ODOO-${suffix}`,
      barcode: "",
      referenceNumbers: [],
    });
    assert.equal(providerManaged.kind, "provider_managed");

    const providerEnrichment = await updateCompanyCatalogPart({
      ...base,
      catalogPartId: providerPartId,
      expectedVersion: 1,
      description: "Provider part",
      partNumber: `ODOO${suffix}`.toUpperCase(),
      category: "",
      barcode: "",
      manufacturer: "Local manufacturer note",
      referenceNumbers: [`ALT-${suffix}`],
    });
    assert.equal(providerEnrichment.kind, "updated");
    assert.deepEqual(providerEnrichment.part.editableFields, ["manufacturer", "referenceNumbers"]);

    const evidence = await query(
      "select count(*)::int as count, min(version_before)::int as first_version from part_catalog_edit_events where company_id = $1",
      [companyId],
    );
    assert.equal(evidence.rows[0].count, 3);
    assert.equal(evidence.rows[0].first_version, 1);
  } finally {
    await query("delete from companies where id in ($1, $2)", [companyId, otherCompanyId]).catch(() => {});
    await query("delete from user_profiles where id = $1", [actorId]).catch(() => {});
  }
});
