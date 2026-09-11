import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closePool, query } from "../../db/pool.js";
import { postAggregateStockIntake } from "../../db/repositories/inventory-stock-intake.repo.js";

const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === "1";
after(async () => { if (runPostgres) await closePool(); });

test("real PostgreSQL posts quantity and measured intake atomically and replays exactly once", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID(); const companyId = randomUUID(); const locationId = randomUUID();
  const quantityPartId = randomUUID(); const measuredPartId = randomUUID();
  const base = { actorId, companyIds: [companyId], locationIds: [locationId], isAdmin: false, locationId,
    confirmation: "physically_present_at_location" };
  try {
    await query("insert into user_profiles (id,display_name) values ($1,'Stock intake integration')", [actorId]);
    await query("insert into companies (id,slug,name) values ($1,$2,'Stock intake integration')", [companyId, `stock-intake-${suffix}`]);
    await query("insert into locations (id,company_id,name) values ($1,$2,'Intake shop')", [locationId, companyId]);
    await query(`insert into parts_catalog
      (id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode)
      values ($1,$2,$3,$4,'Count item','ea','quantity'),($5,$2,$6,$7,'Bulk item','gal','measured_bulk')`,
    [quantityPartId, companyId, `COUNT${suffix}`, `COUNT-${suffix}`, measuredPartId, `BULK${suffix}`, `BULK-${suffix}`]);

    const quantityCommand = { ...base, catalogPartId: quantityPartId, quantity: 4, uomCode: "ea", trackingMode: "quantity",
      idempotencyKey: `quantity-${suffix}` };
    const posted = await postAggregateStockIntake(quantityCommand);
    const replay = await postAggregateStockIntake(quantityCommand);
    assert.equal(posted.kind, "posted"); assert.equal(replay.kind, "replay"); assert.equal(replay.receiptId, posted.receiptId);
    const revokedReplay = await postAggregateStockIntake({ ...quantityCommand, locationIds: [] });
    assert.equal(revokedReplay.kind, "not_found");
    const fractionalCount = await postAggregateStockIntake({ ...quantityCommand, quantity: 1.5, idempotencyKey: `fraction-${suffix}` });
    assert.equal(fractionalCount.kind, "unsupported_uom");
    const measured = await postAggregateStockIntake({ ...base, catalogPartId: measuredPartId, quantity: 1.005, uomCode: "gal",
      trackingMode: "measured_bulk", idempotencyKey: `measured-${suffix}` });
    assert.equal(measured.kind, "posted");
    const proof = await query(`select
      (select count(*)::int from inventory_manual_intake_batches where company_id=$1) batches,
      (select count(*)::int from inventory_receipts where company_id=$1 and provider='local_manual') receipts,
      (select count(*)::int from inventory_stock_movements where company_id=$1 and movement_type='manual_receipt') movements,
      (select sum(quantity_on_hand) from inventory_items where company_id=$1) total`, [companyId]);
    assert.deepEqual(proof.rows[0], { batches: 2, receipts: 2, movements: 2, total: "5.005" });
  } finally {
    await query("delete from inventory_stock_movements where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_items where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_receipt_lines where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_receipts where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_manual_intake_batches where company_id=$1", [companyId]).catch(() => {});
    await query("delete from inventory_authority_cutovers where company_id=$1", [companyId]).catch(() => {});
    await query("delete from parts_catalog where company_id=$1", [companyId]).catch(() => {});
    await query("delete from locations where company_id=$1", [companyId]).catch(() => {});
    await query("delete from companies where id=$1", [companyId]).catch(() => {});
    await query("delete from user_profiles where id=$1", [actorId]).catch(() => {});
  }
});
