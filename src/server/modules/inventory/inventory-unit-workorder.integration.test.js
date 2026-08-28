import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import {
  finalizeSerializedUnitUsage,
  issueSerializedUnitToWorkorder,
  listWorkorderSerializedUnitUsages,
} from "../../db/repositories/inventory-unit-workorder-usage.repo.js";
import { closePool, query } from "../../db/pool.js";

const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === "1";

after(async () => {
  if (runPostgres) await closePool();
});

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("real PostgreSQL serializes issue/install/return and replays without duplicate stock evidence", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID();
  const companyId = randomUUID();
  const locationId = randomUUID();
  const assetId = randomUUID();
  const workorderId = randomUUID();
  const runId = randomUUID();
  const receiptId = randomUUID();
  const lineId = randomUUID();
  const catalogPartId = randomUUID();
  const unitA = randomUUID();
  const unitB = randomUUID();
  const scope = { actorId, companyIds: [companyId], locationIds: [locationId], workorderId };
  try {
    await query("insert into user_profiles (id, display_name) values ($1, $2)", [actorId, `Serialized mechanic ${suffix}`]);
    await query("insert into companies (id, slug, name) values ($1, $2, $3)", [companyId, `serialized-${suffix}`, "Serialized usage integration"]);
    await query("insert into locations (id, company_id, name) values ($1, $2, 'Serialized shop')", [locationId, companyId]);
    await query(
      "insert into location_workorder_policies (location_id, company_id, mechanic_can_record_parts) values ($1, $2, true)",
      [locationId, companyId],
    );
    await query(
      "insert into assets (id, company_id, location_id, provider, name, unit_no) values ($1, $2, $3, 'manual', 'Integration truck', $4)",
      [assetId, companyId, locationId, `T-${suffix.slice(0, 8)}`],
    );
    await query(
      `insert into operational_workorders (
         id, company_id, serial, asset_id, location_id, created_by_user_id, concern, status
       ) values ($1,$2,$3,$4,$5,$6,'Serialized part integration','in_progress')`,
      [workorderId, companyId, `WO-SERIAL-${suffix}`, assetId, locationId, actorId],
    );
    await query(
      `insert into workorder_mechanic_assignments (
         workorder_id, mechanic_user_id, assignment_role, active, assigned_by_user_id
       ) values ($1,$2,'primary',true,$2)`,
      [workorderId, actorId],
    );
    await query(
      `insert into parts_catalog (
         id, company_id, normalized_part_number, part_number, description, uom_code
       ) values ($1,$2,$3,$4,'Serialized integration filter','ea')`,
      [catalogPartId, companyId, `SERIAL${suffix}`, `SERIAL-${suffix}`],
    );
    const draft = JSON.stringify({ documentType: { value: "invoice" }, lines: [] });
    await query(
      `insert into invoice_extraction_runs (
         id, company_id, location_id, created_by, reviewed_by, document_hash,
         file_name, mime_type, byte_size, idempotency_key, status, provider,
         model, prompt_version, reviewed_draft, reviewed_at
       ) values ($1,$2,$3,$4,$4,$5,'serialized.pdf','application/pdf',1,$6,
         'reviewed','local-test','local-test','local-v1',$7::jsonb,now())`,
      [runId, companyId, locationId, actorId, digest(suffix), `extract-${suffix}`, draft],
    );
    await query(
      `insert into local_inventory_receipts (
         id, company_id, location_id, invoice_run_id, created_by, idempotency_key,
         request_hash, status, line_count, total_quantity, reviewed_run_version,
         physical_confirmation, confirmation_hash
       ) values ($1,$2,$3,$4,$5,$6,$7,'posted',1,2,1,'all_received_undamaged',$7)`,
      [receiptId, companyId, locationId, runId, actorId, `receipt-${suffix}`, digest(`receipt-${suffix}`)],
    );
    await query(
      `insert into inventory_receipts (
         id, company_id, location_id, invoice_run_id, created_by, idempotency_key,
         provider, provider_marker, provider_picking_name, status, confirmed_at
       ) values ($1,$2,$3,$4,$5,$6,'local',$7,'Local receipt','confirmed',now())`,
      [receiptId, companyId, locationId, runId, actorId, `receipt-${suffix}`, `LOCAL-${suffix}`],
    );
    await query(
      `insert into local_inventory_receipt_lines (
         id, company_id, receipt_id, line_index, catalog_part_id,
         normalized_part_number, part_number, description, quantity, uom_code
       ) values ($1,$2,$3,0,$4,$5,$6,'Serialized integration filter',2,'ea')`,
      [lineId, companyId, receiptId, catalogPartId, `SERIAL${suffix}`, `SERIAL-${suffix}`],
    );
    await query(
      `insert into inventory_receipt_lines (
         id, company_id, receipt_id, line_index, catalog_part_id, product_external_id,
         part_number, description, quantity, uom_code, tracking_mode
       ) values ($1,$2,$3,0,$4,$5,$6,'Serialized integration filter',2,'ea','serial')`,
      [lineId, companyId, receiptId, catalogPartId, `local:${catalogPartId}`, `SERIAL-${suffix}`],
    );
    await query(
      `insert into inventory_serialized_units (
         id, company_id, location_id, receipt_id, receipt_line_id, unit_ordinal, serial_number, status
       ) values ($1,$3,$4,$5,$6,1,$7,'in_stock'), ($2,$3,$4,$5,$6,2,$8,'in_stock')`,
      [unitA, unitB, companyId, locationId, receiptId, lineId, `WG-L-${suffix}-1`, `WG-L-${suffix}-2`],
    );
    await query(
      `insert into inventory_items (
         company_id, location_id, catalog_part_id, normalized_part_number, part_number,
         description, quantity_on_hand, quantity_reserved, uom_code, source_provider, external_id
       ) values ($1,$2,$3,$4,$5,'Serialized integration filter',2,0,'ea','local',$6)`,
      [companyId, locationId, catalogPartId, `SERIAL${suffix}`, `SERIAL-${suffix}`, `local:${suffix}`],
    );

    const replayCommand = {
      ...scope, unitId: unitA, idempotencyKey: `issue-a-${suffix}`, requestHash: digest(`issue-a-${suffix}`),
    };
    const replays = await Promise.all([
      issueSerializedUnitToWorkorder(replayCommand),
      issueSerializedUnitToWorkorder(replayCommand),
    ]);
    assert.deepEqual(replays.map((result) => result.kind).sort(), ["issued", "replay"]);
    const usageA = replays.find((result) => result.usage)?.usage;

    const returnCommand = {
      ...scope, usageId: usageA.id, disposition: "returned",
      idempotencyKey: `return-a-${suffix}`, requestHash: digest(`return-a-${suffix}`),
    };
    const returns = await Promise.all([
      finalizeSerializedUnitUsage(returnCommand),
      finalizeSerializedUnitUsage(returnCommand),
    ]);
    assert.deepEqual(returns.map((result) => result.kind).sort(), ["finalized", "replay"]);

    const competing = await Promise.all([
      issueSerializedUnitToWorkorder({ ...scope, unitId: unitB, idempotencyKey: `issue-b1-${suffix}`, requestHash: digest("b1") }),
      issueSerializedUnitToWorkorder({ ...scope, unitId: unitB, idempotencyKey: `issue-b2-${suffix}`, requestHash: digest("b2") }),
    ]);
    assert.deepEqual(competing.map((result) => result.kind).sort(), ["issued", "unit_state"]);
    const usageB = competing.find((result) => result.kind === "issued").usage;
    const installCommand = {
      ...scope, usageId: usageB.id, disposition: "installed",
      idempotencyKey: `install-b-${suffix}`, requestHash: digest(`install-b-${suffix}`),
    };
    assert.equal((await finalizeSerializedUnitUsage(installCommand)).kind, "finalized");
    await query("update operational_workorders set status = 'mechanic_done' where id = $1", [workorderId]);
    assert.equal((await finalizeSerializedUnitUsage(installCommand)).kind, "replay");

    const snapshot = await query(
      `select
         (select quantity_on_hand from inventory_items where company_id = $1 and catalog_part_id = $2 and location_id = $3) as on_hand,
         (select count(*)::integer from inventory_stock_movements where company_id = $1 and movement_type = 'issue') as issues,
         (select count(*)::integer from inventory_stock_movements where company_id = $1 and movement_type = 'return') as returns,
         (select count(*)::integer from inventory_unit_events where company_id = $1 and event_type = 'installed') as installed_events,
         (select status from inventory_serialized_units where company_id = $1 and id = $4) as returned_unit_status`,
      [companyId, catalogPartId, locationId, unitA],
    );
    assert.deepEqual(snapshot.rows[0], {
      on_hand: "1.000", issues: 2, returns: 1, installed_events: 1, returned_unit_status: "in_stock",
    });
    const refreshed = await listWorkorderSerializedUnitUsages({
      workorderId, actorId, companyIds: [companyId], locationIds: [locationId], limit: 100,
    });
    assert.deepEqual(refreshed.map((usage) => usage.status).sort(), ["installed", "returned"]);
  } finally {
    await query("delete from inventory_unit_events where company_id = $1", [companyId]).catch(() => {});
    await query("delete from inventory_stock_movements where company_id = $1", [companyId]).catch(() => {});
    await query("delete from workorder_serialized_part_usages where company_id = $1", [companyId]).catch(() => {});
    await query("delete from inventory_serialized_units where company_id = $1", [companyId]).catch(() => {});
    await query("delete from inventory_receipt_lines where company_id = $1", [companyId]).catch(() => {});
    await query("delete from local_inventory_receipt_lines where company_id = $1", [companyId]).catch(() => {});
    await query("delete from inventory_receipts where company_id = $1", [companyId]).catch(() => {});
    await query("delete from local_inventory_receipts where company_id = $1", [companyId]).catch(() => {});
    await query("delete from inventory_items where company_id = $1", [companyId]).catch(() => {});
    await query("delete from parts_catalog where company_id = $1", [companyId]).catch(() => {});
    await query("delete from workorder_mechanic_assignments where workorder_id = $1", [workorderId]).catch(() => {});
    await query("delete from operational_workorders where id = $1", [workorderId]).catch(() => {});
    await query("delete from assets where id = $1", [assetId]).catch(() => {});
    await query("delete from invoice_extraction_runs where company_id = $1", [companyId]).catch(() => {});
    await query("delete from location_workorder_policies where company_id = $1", [companyId]).catch(() => {});
    await query("delete from locations where company_id = $1", [companyId]).catch(() => {});
    await query("delete from companies where id = $1", [companyId]).catch(() => {});
    await query("delete from user_profiles where id = $1", [actorId]).catch(() => {});
  }
});
