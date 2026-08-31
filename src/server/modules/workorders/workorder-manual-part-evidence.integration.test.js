import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { closePool, query } from "../../db/pool.js";
import {
  amendWorkorderManualPartEvidence,
  listWorkorderManualPartEvidence,
} from "../../db/repositories/workorder-manual-part-evidence.repo.js";
import { updateOfficeUsedParts } from "../../db/repositories/operational-workorders.repo.js";

const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === "1";
after(async () => { if (runPostgres) await closePool(); });
const digest = (value) => createHash("sha256").update(value).digest("hex");

test("real PostgreSQL keeps legacy manual evidence append-only, scoped, and idempotent", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID(); const companyId = randomUUID(); const locationId = randomUUID();
  const wrongLocationId = randomUUID(); const assetId = randomUUID(); const workorderId = randomUUID();
  const evidenceId = randomUUID();
  const originalPart = { evidenceId, partNo: `LEGACY-${suffix}`, qty: "1", uomCode: "pc", repairOrder: "Installed before cutover" };
  const originalHash = digest(JSON.stringify(originalPart));
  try {
    await query("insert into user_profiles (id,display_name) values ($1,'Manual evidence integration')", [actorId]);
    await query("insert into companies (id,slug,name) values ($1,$2,'Manual evidence integration')", [companyId, `manual-evidence-${suffix}`]);
    await query("insert into locations (id,company_id,name) values ($1,$2,'Manual evidence shop'),($3,$2,'Wrong shop')", [locationId, companyId, wrongLocationId]);
    await query("insert into assets (id,company_id,location_id,provider,name,unit_no) values ($1,$2,$3,'manual','Truck',$4)", [assetId, companyId, locationId, `M-${suffix}`]);
    await query(`insert into operational_workorders
      (id,company_id,serial,asset_id,location_id,created_by_user_id,concern,status,form_data)
      values ($1,$2,$3,$4,$5,$6,'Legacy evidence','in_progress',$7::jsonb)`,
    [workorderId, companyId, `WO-M-${suffix}`, assetId, locationId, actorId, JSON.stringify({ parts: [originalPart] })]);
    await query(`insert into workorder_manual_part_evidence
      (evidence_id,company_id,workorder_id,source_ordinal,original_part,original_hash)
      values ($1,$2,$3,0,$4::jsonb,$5)`, [evidenceId, companyId, workorderId, JSON.stringify(originalPart), originalHash]);

    const command = {
      workorderId, evidenceId, actorId, companyIds: [companyId], locationIds: [locationId], isAdmin: false,
      action: "corrected", replacementPart: { partNo: originalPart.partNo, qty: "2", uomCode: "pc", repairOrder: "Verified quantity" },
      reason: "Physical record verified", idempotencyKey: `manual-${suffix}`, requestHash: digest("request-a"),
    };
    const results = await Promise.all([
      amendWorkorderManualPartEvidence(command),
      amendWorkorderManualPartEvidence(command),
    ]);
    assert.deepEqual(results.map((result) => result.kind).sort(), ["amended", "replay"]);
    const amended = results.find((result) => result.kind === "amended");
    const replayed = results.find((result) => result.kind === "replay");
    assert.equal(replayed.amendmentId, amended.amendmentId);
    assert.equal(replayed.originalHash, amended.originalHash);
    assert.equal(replayed.supersedesAmendmentId, amended.supersedesAmendmentId);
    assert.equal((await amendWorkorderManualPartEvidence({ ...command, requestHash: digest("changed") })).kind, "idempotency_conflict");
    assert.equal((await amendWorkorderManualPartEvidence({
      ...command, locationIds: [wrongLocationId], idempotencyKey: `wrong-${suffix}`, requestHash: digest("wrong"),
    })).kind, "not_found");

    const evidence = await listWorkorderManualPartEvidence({ workorderId, companyId, locationId });
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].originalHash, originalHash);
    assert.equal(evidence[0].effectivePart.qty, "2");
    await updateOfficeUsedParts(workorderId, actorId, [{
      ...evidence[0].effectivePart,
      evidenceId,
    }], "2");
    let saved = (await query("select form_data from operational_workorders where id=$1", [workorderId])).rows[0].form_data;
    assert.equal(saved.parts[0].qty, "1", "corrected projection must not replace immutable raw evidence");
    assert.equal(saved.laborHours, "2", "labor must still save beside a corrected projection");

    const voided = await amendWorkorderManualPartEvidence({
      ...command,
      action: "voided",
      replacementPart: null,
      reason: "Historical row was duplicated",
      idempotencyKey: `manual-void-${suffix}`,
      requestHash: digest("request-void"),
    });
    assert.equal(voided.kind, "amended");
    const voidedEvidence = await listWorkorderManualPartEvidence({ workorderId, companyId, locationId });
    assert.equal(voidedEvidence[0].effectivePart, null);
    await updateOfficeUsedParts(workorderId, actorId, [], "3");
    saved = (await query("select form_data from operational_workorders where id=$1", [workorderId])).rows[0].form_data;
    assert.equal(saved.parts[0].qty, "1", "voided projection must not delete immutable raw evidence");
    assert.equal(saved.laborHours, "3", "labor must still save beside a voided projection");
    assert.equal((await query("select count(*)::integer as count from workorder_manual_part_amendments where company_id=$1", [companyId])).rows[0].count, 2);
    assert.equal((await query("select count(*)::integer as count from inventory_stock_movements where company_id=$1", [companyId])).rows[0].count, 0);
  } finally {
    await query("delete from workorder_manual_part_amendments where company_id=$1", [companyId]).catch(() => {});
    await query("delete from workorder_manual_part_evidence where company_id=$1", [companyId]).catch(() => {});
    await query("delete from operational_workorders where company_id=$1", [companyId]).catch(() => {});
    await query("delete from assets where company_id=$1", [companyId]).catch(() => {});
    await query("delete from locations where company_id=$1", [companyId]).catch(() => {});
    await query("delete from companies where id=$1", [companyId]).catch(() => {});
    await query("delete from user_profiles where id=$1", [actorId]).catch(() => {});
  }
});
