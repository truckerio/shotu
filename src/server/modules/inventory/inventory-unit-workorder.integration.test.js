import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import {
  finalizeSerializedUnitUsage,
  issueSerializedUnitToWorkorder,
  listWorkorderInstalledSerializedParts,
  listWorkorderSerializedUnitUsages,
  updateSerializedUsageRepairOrder,
} from "../../db/repositories/inventory-unit-workorder-usage.repo.js";
import {
  closeOperationalWorkorder,
  getWorkorderTimeline,
} from "../../db/repositories/operational-workorders.repo.js";
import { closePool, query } from "../../db/pool.js";

const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === "1";

after(async () => {
  if (runPostgres) await closePool();
});

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("real PostgreSQL reserves until approval, returns unused parts, and rejects legacy removal shortcuts", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID();
  const companyId = randomUUID();
  const locationId = randomUUID();
  const assetId = randomUUID();
  const workorderId = randomUUID();
  const secondAssetId = randomUUID();
  const secondWorkorderId = randomUUID();
  const runId = randomUUID();
  const receiptId = randomUUID();
  const lineId = randomUUID();
  const catalogPartId = randomUUID();
  const unitA = randomUUID();
  const unitB = randomUUID();
  const scope = { actorId, actorRole: "office", companyId, locationId, workorderId };
  try {
    await query("insert into user_profiles (id, display_name) values ($1, $2)", [actorId, `Serialized mechanic ${suffix}`]);
    await query("insert into companies (id, slug, name) values ($1, $2, $3)", [companyId, `serialized-${suffix}`, "Serialized usage integration"]);
    await query("insert into locations (id, company_id, name) values ($1, $2, 'Serialized shop')", [locationId, companyId]);
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

    assert.equal((await issueSerializedUnitToWorkorder({
      ...scope,
      actorRole: "mechanic",
      unitId: unitA,
      idempotencyKey: `denied-mechanic-${suffix}`,
      requestHash: digest("denied-mechanic"),
    })).kind, "missing");

    const replayCommand = {
      ...scope, unitId: unitA, idempotencyKey: `issue-a-${suffix}`, requestHash: digest(`issue-a-${suffix}`),
    };
    const replays = await Promise.all([
      issueSerializedUnitToWorkorder(replayCommand),
      issueSerializedUnitToWorkorder(replayCommand),
    ]);
    assert.deepEqual(replays.map((result) => result.kind).sort(), ["replay", "reserved"]);
    const usageA = replays.find((result) => result.usage)?.usage;
    assert.deepEqual((await query(
      "select quantity_on_hand, quantity_reserved from inventory_items where company_id = $1 and location_id = $2 and catalog_part_id = $3",
      [companyId, locationId, catalogPartId],
    )).rows[0], { quantity_on_hand: "2.000", quantity_reserved: "1.000" });

    const returnCommand = {
      ...scope, usageId: usageA.id, disposition: "returned",
      idempotencyKey: `return-a-${suffix}`, requestHash: digest(`return-a-${suffix}`),
    };
    const returns = await Promise.all([
      finalizeSerializedUnitUsage(returnCommand),
      finalizeSerializedUnitUsage(returnCommand),
    ]);
    assert.deepEqual(returns.map((result) => result.kind).sort(), ["finalized", "replay"]);
    assert.deepEqual((await query(
      "select quantity_on_hand, quantity_reserved from inventory_items where company_id = $1 and location_id = $2 and catalog_part_id = $3",
      [companyId, locationId, catalogPartId],
    )).rows[0], { quantity_on_hand: "2.000", quantity_reserved: "0.000" });

    const removedBeforeApproval = await issueSerializedUnitToWorkorder({
      ...scope, unitId: unitA, idempotencyKey: `issue-a2-${suffix}`, requestHash: digest(`issue-a2-${suffix}`),
    });
    assert.equal(removedBeforeApproval.kind, "reserved");
    assert.equal((await finalizeSerializedUnitUsage({
      ...scope, usageId: removedBeforeApproval.usage.id, disposition: "returned",
      idempotencyKey: `remove-return-a2-${suffix}`, requestHash: digest(`remove-return-a2-${suffix}`),
    })).kind, "finalized");

    const competing = await Promise.all([
      issueSerializedUnitToWorkorder({ ...scope, unitId: unitB, idempotencyKey: `issue-b1-${suffix}`, requestHash: digest("b1") }),
      issueSerializedUnitToWorkorder({ ...scope, unitId: unitB, idempotencyKey: `issue-b2-${suffix}`, requestHash: digest("b2") }),
    ]);
    assert.deepEqual(competing.map((result) => result.kind).sort(), ["reserved", "unit_state"]);
    const usageB = competing.find((result) => result.kind === "reserved").usage;
    const installCommand = {
      ...scope, usageId: usageB.id, disposition: "installed",
      idempotencyKey: `install-b-${suffix}`, requestHash: digest(`install-b-${suffix}`),
    };
    assert.equal((await finalizeSerializedUnitUsage(installCommand)).kind, "finalized");
    assert.equal((await listWorkorderSerializedUnitUsages({ ...scope, limit: 100 }))
      .find((usage) => usage.id === usageB.id).status, "installed_pending_approval");
    assert.equal((await updateSerializedUsageRepairOrder({
      ...scope,
      usageId: usageB.id,
      repairOrder: "Install serialized integration filter and inspect for leaks.",
      allowedWorkorderStatuses: ["open", "accepted", "in_progress", "mechanic_done"],
    })).kind, "updated");
    assert.deepEqual((await query(
      "select quantity_on_hand, quantity_reserved from inventory_items where company_id = $1 and location_id = $2 and catalog_part_id = $3",
      [companyId, locationId, catalogPartId],
    )).rows[0], { quantity_on_hand: "2.000", quantity_reserved: "1.000" });
    await query("update operational_workorders set status = 'mechanic_done' where id = $1", [workorderId]);
    assert.equal((await finalizeSerializedUnitUsage(installCommand)).kind, "replay");
    await closeOperationalWorkorder(workorderId, actorId, "Approved serialized installation.");

    assert.deepEqual(await listWorkorderInstalledSerializedParts({
      workorderId, companyId, locationId, limit: 500,
    }), [{
      usageId: usageB.id,
      catalogPartId,
      serialNumber: `WG-L-${suffix}-2`,
      partNumber: `SERIAL-${suffix}`,
      description: "Serialized integration filter",
      repairOrder: "Install serialized integration filter and inspect for leaks.",
      quantity: 1,
      uomCode: "ea",
    }]);
    assert.equal((await query(
      `select count(*)::integer as count from workorder_field_events
       where workorder_id = $1 and field_key = 'serialized_usage_repair_order'`,
      [workorderId],
    )).rows[0].count, 1);
    assert.equal((await finalizeSerializedUnitUsage({
      ...scope, usageId: usageB.id, disposition: "removed",
      idempotencyKey: `remove-b-${suffix}`, requestHash: digest(`remove-b-${suffix}`),
    })).kind, "custody_required");

    const snapshot = await query(
      `select
         (select quantity_on_hand from inventory_items where company_id = $1 and catalog_part_id = $2 and location_id = $3) as on_hand,
         (select count(*)::integer from inventory_stock_movements where company_id = $1 and movement_type = 'issue') as issues,
         (select count(*)::integer from inventory_stock_movements where company_id = $1 and movement_type = 'return') as returns,
         (select count(*)::integer from inventory_unit_events where company_id = $1 and event_type = 'installed') as installed_events,
         (select quantity_reserved from inventory_items where company_id = $1 and catalog_part_id = $2 and location_id = $3) as reserved,
         (select status from inventory_serialized_units where company_id = $1 and id = $4) as removed_unit_status`,
      [companyId, catalogPartId, locationId, unitB],
    );
    assert.deepEqual(snapshot.rows[0], {
      on_hand: "1.000", issues: 1, returns: 0, installed_events: 1, reserved: "0.000", removed_unit_status: "installed",
    });
    await query(
      "insert into assets (id, company_id, location_id, provider, name, unit_no) values ($1,$2,$3,'manual','Second integration truck',$4)",
      [secondAssetId, companyId, locationId, `B-${suffix.slice(0, 8)}`],
    );
    await query(
      `insert into operational_workorders (id, company_id, serial, asset_id, location_id, created_by_user_id, concern, status)
       values ($1,$2,$3,$4,$5,$6,'Cross-vehicle serialized test','in_progress')`,
      [secondWorkorderId, companyId, `WO-SECOND-${suffix}`, secondAssetId, locationId, actorId],
    );
    const secondScope = { ...scope, workorderId: secondWorkorderId };
    // The denied legacy removal must not free the installed identity for another truck.
    assert.equal((await issueSerializedUnitToWorkorder({
      ...secondScope, unitId: unitB, idempotencyKey: `unsafe-reuse-${suffix}`, requestHash: digest("unsafe-reuse"),
    })).kind, "unit_state");
    assert.equal((await query(
      "select status from inventory_serialized_units where company_id=$1 and id=$2",
      [companyId, unitB],
    )).rows[0].status, "installed");
    // An unused returned unit can be reserved on another vehicle without cloning its identity.
    const secondIssue = await issueSerializedUnitToWorkorder({
      ...secondScope, unitId: unitA, idempotencyKey: `second-issue-${suffix}`, requestHash: digest("second-issue"),
    });
    assert.equal(secondIssue.kind, "reserved");
    assert.notEqual(secondIssue.usage.id, usageA.id);
    const placement = (await query(
      "select unit_id, asset_id, workorder_id from workorder_serialized_part_usages where id=$1",
      [secondIssue.usage.id],
    )).rows[0];
    assert.deepEqual(placement, { unit_id: unitA, asset_id: secondAssetId, workorder_id: secondWorkorderId });
    assert.equal((await finalizeSerializedUnitUsage({
      ...secondScope, usageId: secondIssue.usage.id, disposition: "returned",
      idempotencyKey: `second-return-${suffix}`, requestHash: digest("second-return"),
    })).kind, "finalized");
    assert.deepEqual((await query(
      "select quantity_on_hand, quantity_reserved from inventory_items where company_id=$1 and catalog_part_id=$2 and location_id=$3",
      [companyId, catalogPartId, locationId],
    )).rows[0], { quantity_on_hand: "1.000", quantity_reserved: "0.000" });
    const refreshed = await listWorkorderSerializedUnitUsages({ ...scope, limit: 100 });
    assert.deepEqual(refreshed.map((usage) => usage.status).sort(), ["installed", "returned", "returned"]);
    const serializedTimeline = (await getWorkorderTimeline(workorderId)).filter((event) => event.type === "part");
    assert.deepEqual(serializedTimeline.map((event) => event.action), [
      "reserved", "returned", "reserved", "returned",
      "reserved", "installed_pending_approval", "installed",
    ]);
    assert.equal(serializedTimeline[0].part_number, `SERIAL-${suffix}`);
    assert.equal(serializedTimeline[0].serial_number, `WG-L-${suffix}-1`);
    assert.ok(serializedTimeline.every((event) => event.note.includes(`SERIAL-${suffix}`)));
    assert.ok(serializedTimeline.every((event) => event.note.includes("WG-L-")));
    await query(
      `insert into workorder_mechanic_assignments (
         workorder_id, mechanic_user_id, assignment_role, active, assigned_by_user_id
       ) values ($1,$2,'primary',true,$2)`,
      [workorderId, actorId],
    );
    const grantedMechanicView = await listWorkorderSerializedUnitUsages({ ...scope, actorRole: "mechanic", limit: 100 });
    assert.equal(grantedMechanicView.length, 3);
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
    await query("delete from operational_workorders where id = $1", [secondWorkorderId]).catch(() => {});
    await query("delete from assets where id = $1", [secondAssetId]).catch(() => {});
    await query("delete from assets where id = $1", [assetId]).catch(() => {});
    await query("delete from invoice_extraction_runs where company_id = $1", [companyId]).catch(() => {});
    await query("delete from locations where company_id = $1", [companyId]).catch(() => {});
    await query("delete from companies where id = $1", [companyId]).catch(() => {});
    await query("delete from user_profiles where id = $1", [actorId]).catch(() => {});
  }
});
