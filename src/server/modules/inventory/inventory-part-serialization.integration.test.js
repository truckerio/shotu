import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import {
  createPartSerializedUnits,
  getPartLocationSerialization,
} from "../../db/repositories/inventory-part-serialization.repo.js";
import { getSerializedInventoryUnit } from "../../db/repositories/inventory-receipts.repo.js";
import { listLocalInventoryStock } from "../../db/repositories/local-inventory.repo.js";
import { closePool, query } from "../../db/pool.js";

const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === "1";

after(async () => {
  if (runPostgres) await closePool();
});

test("real PostgreSQL keeps Odoo reference unchanged while serialized intake adds exact local children", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID();
  const companyId = randomUUID();
  const locationId = randomUUID();
  const emptyLocationId = randomUUID();
  const partId = randomUUID();
  const idempotencyKey = `serialize-${suffix}`;
  try {
    await query("insert into user_profiles (id, display_name) values ($1,$2)", [actorId, `Serialization ${suffix}`]);
    await query("insert into companies (id, slug, name) values ($1,$2,$3)", [companyId, `serialization-${suffix}`, "Serialization integration"]);
    await query(
      "insert into locations (id, company_id, name) values ($1,$2,'QR Yard'),($3,$2,'Empty Yard')",
      [locationId, companyId, emptyLocationId],
    );
    await query(
      `insert into parts_catalog (id, company_id, normalized_part_number, part_number, description, uom_code)
       values ($1,$2,$3,$4,'Serialized integration part','ea')`,
      [partId, companyId, `SERIAL${suffix}`, `SERIAL-${suffix}`],
    );
    await query(
      `insert into odoo_inventory_balances (
         company_id, location_id, catalog_part_id, normalized_part_number,
         part_number, description, uom_code, quantity_on_hand, external_id
       ) values ($1,$2,$3,$4,$5,'Serialized integration part','ea',4,$6)`,
      [companyId, locationId, partId, `SERIAL${suffix}`, `SERIAL-${suffix}`, `odoo-${suffix}`],
    );

    const command = () => createPartSerializedUnits({
      catalogPartId: partId,
      locationId,
      quantity: 2,
      confirmation: "physically_present_at_location",
      idempotencyKey,
      actorId,
      companyIds: [companyId],
      locationIds: [locationId],
    });
    const concurrent = await Promise.all([command(), command()]);
    assert.deepEqual(concurrent.map((result) => result.replayed).sort(), [false, true]);
    const created = concurrent.find((result) => !result.replayed);
    assert.equal(created.kind, "created");
    assert.equal(created.replayed, false);
    assert.equal(created.batch.itemCount, 2);

    const replay = await command();
    assert.equal(replay.replayed, true);

    await query("update parts_catalog set inventory_display_uom_code='pc' where id=$1", [partId]);
    const detail = await getPartLocationSerialization({ catalogPartId: partId, locationId, companyIds: [companyId] });
    assert.equal(detail.part.uomCode, "pc");
    assert.equal(detail.location.localQuantityOnHand, 2);
    assert.equal(detail.location.odooQuantityOnHand, 4);
    assert.equal(detail.units.length, 2);
    assert.ok(detail.units.every((unit) => unit.serialNumber.startsWith("WG-S-") && unit.status === "in_stock"));

    const unitDetail = await getSerializedInventoryUnit({
      unitId: detail.units[0].id,
      companyIds: [companyId],
      isAdmin: true,
    });
    assert.equal(unitDetail.source.type, "manual");
    assert.equal(unitDetail.createdBy.name, `Serialization ${suffix}`);
    assert.equal(unitDetail.labelBatch.itemCount, 2);
    assert.equal(unitDetail.events[0].type, "receipt_recorded");
    assert.equal(unitDetail.events[0].actor.name, `Serialization ${suffix}`);
    assert.equal(await getSerializedInventoryUnit({
      unitId: detail.units[0].id,
      companyIds: [randomUUID()],
      isAdmin: true,
    }), null);
    assert.equal(await getSerializedInventoryUnit({
      unitId: detail.units[0].id,
      companyIds: [companyId],
      locationIds: [emptyLocationId],
      isAdmin: false,
    }), null);

    const stock = await listLocalInventoryStock({
      companyIds: [companyId],
      isAdmin: true,
      queryText: `SERIAL-${suffix}`,
      limit: 10,
    });
    assert.deepEqual(stock[0].locations.map((location) => ({
      id: location.locationId,
      local: Number(location.quantityOnHand),
      odoo: Number(location.odooQuantityOnHand),
    })), [
      { id: emptyLocationId, local: 0, odoo: 0 },
      { id: locationId, local: 2, odoo: 4 },
    ]);

    const evidence = await query(
      `select
         (select count(*)::integer from inventory_serialization_batches where company_id=$1) as batches,
         (select count(*)::integer from inventory_receipts where company_id=$1 and provider='local_serialization') as receipts,
         (select count(*)::integer from inventory_stock_movements where company_id=$1) as movements,
         (select count(*)::integer from inventory_label_batch_items where company_id=$1) as labels,
         (select quantity_on_hand from inventory_items where company_id=$1 and catalog_part_id=$2 and location_id=$3 and source_provider='local') as local_quantity,
         (select quantity_on_hand from odoo_inventory_balances where company_id=$1 and catalog_part_id=$2 and location_id=$3) as odoo_quantity`,
      [companyId, partId, locationId],
    );
    assert.deepEqual(evidence.rows[0], {
      batches: 1,
      receipts: 1,
      movements: 1,
      labels: 2,
      local_quantity: "2.000",
      odoo_quantity: "4.000",
    });
  } finally {
    await query("delete from inventory_label_batch_items where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_label_batches where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_unit_events where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_serialized_units where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_stock_movements where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_receipt_lines where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_receipts where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_serialization_batches where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_items where company_id=$1", [companyId]).catch(() => {});
    await query("delete from odoo_inventory_balances where company_id=$1", [companyId]).catch(() => {});
    await query("delete from parts_catalog where company_id=$1", [companyId]).catch(() => {});
    await query("delete from locations where company_id=$1", [companyId]).catch(() => {});
    await query("delete from companies where id=$1", [companyId]).catch(() => {});
    await query("delete from user_profiles where id=$1", [actorId]).catch(() => {});
  }
});
