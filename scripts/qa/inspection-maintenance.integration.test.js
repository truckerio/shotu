import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { canonicalizeInspectionDeferral, evaluateInspectionMaintenance } from "../../shared/inspection-maintenance.js";
import { closePool, getPool, query } from "../../src/server/db/pool.js";
import * as inspectionRepository from "../../src/server/db/repositories/inspections.repo.js";
import * as maintenanceRepository from "../../src/server/db/repositories/inspection-maintenance.repo.js";
import * as mileageRepository from "../../src/server/db/repositories/asset-mileage.repo.js";
import { listUserActivity } from "../../src/server/db/repositories/user-activity.repo.js";
import { seedInspectionMaintenanceBase, seedMaintenanceFixture } from "./inspection-maintenance-fixture.js";

const enabled = process.env.RUN_INSPECTION_MAINTENANCE_INTEGRATION === "1";
const DISPOSABLE_DATABASE = /^\/inspection_maintenance_test_[a-f0-9]{32}$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

if (enabled) {
  const database = new URL(process.env.DATABASE_URL || "");
  assert.ok(LOOPBACK_HOSTS.has(database.hostname), "Integration database must be loopback PostgreSQL.");
  assert.match(database.pathname, DISPOSABLE_DATABASE, "Use the disposable inspection-maintenance runner database only.");
}

after(async () => {
  if (enabled) await closePool();
});

test("inspection maintenance migrations and lifecycle hold in real PostgreSQL transactions", { skip: !enabled }, async (t) => {
  for (const name of ["saveInspectionResponses", "transitionInspection", "createInspectionCorrection", "resolveInspectionFollowUp"]) {
    assert.equal(typeof inspectionRepository[name], "function", `Missing inspection repository export: ${name}`);
  }
  assert.equal(typeof maintenanceRepository.listInspectionMaintenance, "function", "Missing maintenance repository export: listInspectionMaintenance");
  for (const name of ["readAssetMileage", "recordProviderAssetMileage", "recordManualAssetMileage"]) {
    assert.equal(typeof mileageRepository[name], "function", `Missing mileage repository export: ${name}`);
  }

  await t.test("migration ledger is complete and unique after replay", async () => {
    const rows = await query(`select name,count(*)::integer count from schema_migrations
      where name in ('198_inspection_maintenance_deferrals.sql','199_asset_mileage_observations.sql') group by name order by name`);
    assert.deepEqual(rows.rows, [
      { name:"198_inspection_maintenance_deferrals.sql", count:1 },
      { name:"199_asset_mileage_observations.sql", count:1 },
    ]);
  });

  const fixture = await seedInspectionMaintenanceBase(getPool());
  const deferral = {
    reason: "Safe to repair during the next service window.",
    nextVisit: true,
    dueDate: null,
    dueMiles: 10_000,
    baselineMiles: 9_800,
    additionalMiles: 200,
    earlyMiles: 200,
  };

  let completed;
  let originalFinding;
  let obligationId;

  await t.test("Attention deferral persists atomically and schema rejects invalid deferrals", async () => {
    const saved = await inspectionRepository.saveInspectionResponses({
      inspectionId: fixture.sourceInspectionId,
      companyIds: [fixture.companyId],
      expectedVersion: 1,
      actorId: fixture.mechanicId,
      responses: [{
        itemKey: "air-leak",
        response: "issue",
        naReason: "",
        finding: { severity:"attention", note:"Small air leak at fitting.", disposition:"defer", noWorkorderReason:"", deferral },
      }],
    });
    assert.equal(saved.version, 2);
    originalFinding = saved.findings.find((finding) => finding.disposition === "defer");
    assert.ok(originalFinding?.id);

    const invalidResponseId = randomUUID();
    await query(
      `insert into inspection_responses(id,company_id,inspection_id,item_key,response,updated_by_user_id)
       values($1,$2,$3,'invalid-schema-fixture','issue',$4)`,
      [invalidResponseId, fixture.companyId, fixture.sourceInspectionId, fixture.mechanicId],
    );
    await assert.rejects(
      query(
        `insert into inspection_findings(company_id,inspection_id,response_id,severity,note,disposition,deferral_policy,maintenance_obligation_id)
         values($1,$2,$3,'repair_required','Invalid deferred repair','defer',$4::jsonb,$5)`,
        [fixture.companyId, fixture.sourceInspectionId, invalidResponseId, JSON.stringify(deferral), randomUUID()],
      ),
      (error) => error?.constraint === "inspection_finding_deferral_shape",
    );
    await query("delete from inspection_responses where id=$1", [invalidResponseId]);

    const malformedResponseId = randomUUID();
    await query(
      `insert into inspection_responses(id,company_id,inspection_id,item_key,response,updated_by_user_id)
       values($1,$2,$3,'malformed-schema-fixture','issue',$4)`,
      [malformedResponseId, fixture.companyId, fixture.sourceInspectionId, fixture.mechanicId],
    );
    await assert.rejects(
      query(
        `insert into inspection_findings(company_id,inspection_id,response_id,severity,note,disposition,deferral_policy,maintenance_obligation_id)
         values($1,$2,$3,'attention','Missing trigger shape','defer',$4::jsonb,$5)`,
        [fixture.companyId, fixture.sourceInspectionId, malformedResponseId, JSON.stringify({ reason:"Missing required keys" }), randomUUID()],
      ),
      (error) => error?.constraint === "inspection_finding_deferral_shape",
    );
    await query("delete from inspection_responses where id=$1", [malformedResponseId]);
    assert.throws(
      () => canonicalizeInspectionDeferral({ ...deferral, nextVisit:false }, { unitType:"Trailer" }),
      (error) => error?.code === "INSPECTION_TRAILER_MILEAGE_UNSUPPORTED",
    );

    completed = await inspectionRepository.transitionInspection({
      inspectionId: fixture.sourceInspectionId,
      companyIds: [fixture.companyId],
      expectedVersion: saved.version,
      toStatus: "completed",
      finalNotes: "Deferred issue recorded.",
      actorId: fixture.mechanicId,
      completionAuthority: "primary_mechanic",
    });
    assert.equal(completed.status, "completed");
    const followUps = await query(
      "select * from inspection_finding_follow_ups where company_id=$1 and inspection_id=$2",
      [fixture.companyId, fixture.sourceInspectionId],
    );
    assert.equal(followUps.rowCount, 1);
    assert.equal(followUps.rows[0].status, "open");
    assert.equal(followUps.rows[0].defer_count, 1);
    obligationId = followUps.rows[0].maintenance_obligation_id;
    assert.ok(obligationId);
  });

  await t.test("repeated deferral is versioned and idempotent", async () => {
    const followUp = (await query(
      "select id,finding_id,version from inspection_finding_follow_ups where company_id=$1 and maintenance_obligation_id=$2",
      [fixture.companyId, obligationId],
    )).rows[0];
    const command = {
      action: "defer",
      inspectionId: fixture.sourceInspectionId,
      findingId: followUp.finding_id,
      companyIds: [fixture.companyId],
      actorId: fixture.officeId,
      expectedVersion: Number(followUp.version),
      reason: "Reviewed again before the next service window.",
      deferral,
      idempotencyKey: `follow-up-defer-${randomUUID()}`,
    };
    const deferred = await inspectionRepository.resolveInspectionFollowUp(command);
    const replay = await inspectionRepository.resolveInspectionFollowUp(command);
    assert.equal(deferred.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal((await query("select defer_count from inspection_finding_follow_ups where id=$1", [followUp.id])).rows[0].defer_count, 2);
    await assert.rejects(
      inspectionRepository.resolveInspectionFollowUp({ ...command, idempotencyKey:`follow-up-defer-${randomUUID()}` }),
      (error) => error?.statusCode === 409,
    );
  });

  await t.test("real mileage evidence drives inclusive thresholds and manual audit replay", async () => {
    const observedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const provider = await mileageRepository.recordProviderAssetMileage({
      assetId: fixture.assetId,
      companyId: fixture.companyId,
      miles: 9_800,
      observedAt,
      source: "samsara_obd",
      providerPayload: { fixture:true },
    });
    assert.equal(provider.state, "fresh");
    assert.equal(provider.version, 1);

    const manualCommand = {
      assetId: fixture.assetId,
      companyId: fixture.companyId,
      actorId: fixture.officeId,
      expectedVersion: provider.version,
      idempotencyKey: `manual-${randomUUID()}`,
      miles: 9_800,
      observedAt,
      reason: "Dashboard verified before inspection.",
      inspectionId: fixture.sourceInspectionId,
    };
    const manual = await mileageRepository.recordManualAssetMileage(manualCommand);
    const replay = await mileageRepository.recordManualAssetMileage(manualCommand);
    assert.equal(manual.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.observationId, manual.observationId);
    assert.equal((await query("select count(*)::integer count from asset_mileage_observations where id=$1", [manual.observationId])).rows[0].count, 1);
    await assert.rejects(
      mileageRepository.recordManualAssetMileage({ ...manualCommand, miles:9_801 }),
      (error) => error?.code === "ASSET_MILEAGE_IDEMPOTENCY_CONFLICT",
    );

    const dueSoon = evaluateInspectionMaintenance({ deferral, mileage:manual, now:new Date() });
    assert.equal(dueSoon.dueState, "due_soon");
    assert.equal(dueSoon.remainingMiles, 200);

    const visitPolicy = { ...deferral, dueMiles:null, baselineMiles:null, additionalMiles:null };
    const sourceCompletedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    assert.equal(evaluateInspectionMaintenance({ deferral:visitPolicy, sourceCompletedAt }).dueState, "upcoming");
    assert.equal(evaluateInspectionMaintenance({
      deferral: visitPolicy,
      sourceCompletedAt,
      visitStartedAt: new Date().toISOString(),
    }).dueState, "due");

    const exact = await mileageRepository.recordManualAssetMileage({
      ...manualCommand,
      expectedVersion: manual.version,
      idempotencyKey: `manual-${randomUUID()}`,
      miles: 10_000,
      reason: "Dashboard verified at maintenance target.",
    });
    assert.equal(evaluateInspectionMaintenance({ deferral, mileage:exact, now:new Date() }).dueState, "due");
    const exceeded = await mileageRepository.recordManualAssetMileage({
      ...manualCommand,
      expectedVersion: exact.version,
      idempotencyKey: `manual-${randomUUID()}`,
      miles: 10_000.1,
      reason: "Dashboard verified beyond maintenance target.",
    });
    assert.equal(evaluateInspectionMaintenance({ deferral, mileage:exceeded, now:new Date() }).dueState, "overdue");

    const activity = await listUserActivity({
      actor: { id:fixture.officeId, role:"office" },
      companyIds: new Set([fixture.companyId]),
      companyRoles: new Map([[fixture.companyId, "office"]]),
      locationIds: new Set([fixture.locationId]),
    }, { category:"inspections", pageSize:100 });
    const mileageActivity = activity.items.find((item) => item.source === "asset_mileage" && item.record_id === exceeded.observationId);
    assert.equal(mileageActivity?.action, "mileage_corrected");
    assert.match(mileageActivity?.description || "", /10000\.0 to 10000\.1 mi/i);
    assert.match(mileageActivity?.description || "", /Dashboard verified beyond maintenance target/i);
  });

  await t.test("backdated manual mileage is audited without replacing newer canonical evidence", async () => {
    const historicalFixture = await seedInspectionMaintenanceBase(getPool());
    const providerObservedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const historicalObservedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    const provider = await mileageRepository.recordProviderAssetMileage({
      assetId: historicalFixture.assetId,
      companyId: historicalFixture.companyId,
      miles: 12_000,
      observedAt: providerObservedAt,
      source: "samsara_obd",
      providerPayload: { fixture:"backdated-manual" },
    });
    assert.equal(provider.state, "fresh");
    assert.equal(provider.version, 1);
    const stateBefore = (await query(
      "select canonical_observation_id,version from asset_mileage_state where company_id=$1 and asset_id=$2",
      [historicalFixture.companyId, historicalFixture.assetId],
    )).rows[0];

    const command = {
      assetId: historicalFixture.assetId,
      companyId: historicalFixture.companyId,
      actorId: historicalFixture.officeId,
      expectedVersion: provider.version,
      idempotencyKey: `manual-backdated-${randomUUID()}`,
      miles: 11_800,
      observedAt: historicalObservedAt,
      reason: "Backdated dashboard correction from service paperwork.",
      inspectionId: historicalFixture.sourceInspectionId,
    };
    const recorded = await mileageRepository.recordManualAssetMileage(command);
    const replay = await mileageRepository.recordManualAssetMileage(command);
    assert.equal(recorded.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.observationId, recorded.observationId);
    for (const result of [recorded, replay]) {
      assert.equal(result.historical, true);
      assert.equal(result.miles, 12_000);
      assert.equal(result.source, "samsara_obd");
      assert.equal(result.observedAt, providerObservedAt);
      assert.equal(result.state, "fresh");
      assert.equal(result.version, 2);
    }

    const stateAfter = (await query(
      "select canonical_observation_id,version,conflict from asset_mileage_state where company_id=$1 and asset_id=$2",
      [historicalFixture.companyId, historicalFixture.assetId],
    )).rows[0];
    assert.equal(stateAfter.canonical_observation_id, stateBefore.canonical_observation_id);
    assert.equal(Number(stateAfter.version), Number(stateBefore.version) + 1);
    assert.equal(stateAfter.conflict, false);
    const compatibility = (await query(
      "select last_odometer_miles,last_odometer_meters from assets where company_id=$1 and id=$2",
      [historicalFixture.companyId, historicalFixture.assetId],
    )).rows[0];
    assert.equal(Number(compatibility.last_odometer_miles), 12_000);
    assert.equal(Number(compatibility.last_odometer_meters), 12_000 * 1609.344);

    const evidence = (await query(
      `select source,miles,observed_at,prior_miles,actor_id,reason
       from asset_mileage_observations where id=$1`,
      [recorded.observationId],
    )).rows[0];
    assert.equal(evidence.source, "manual");
    assert.equal(Number(evidence.miles), 11_800);
    assert.equal(new Date(evidence.observed_at).toISOString(), historicalObservedAt);
    assert.equal(Number(evidence.prior_miles), 12_000);
    assert.equal(evidence.actor_id, historicalFixture.officeId);
    assert.equal(evidence.reason, command.reason);
    const commands = await query(
      "select count(*)::integer count from asset_mileage_commands where company_id=$1 and observation_id=$2",
      [historicalFixture.companyId, recorded.observationId],
    );
    assert.equal(commands.rows[0].count, 1);
  });

  let correction;
  await t.test("correction retains one active stable obligation and latest repeated deferral", async () => {
    const priorFollowUp = (await query(
      "select * from inspection_finding_follow_ups where company_id=$1 and maintenance_obligation_id=$2 and status<>'superseded'",
      [fixture.companyId, obligationId],
    )).rows[0];
    await inspectionRepository.resolveInspectionFollowUp({
      action: "defer", inspectionId: fixture.sourceInspectionId, findingId: priorFollowUp.finding_id,
      companyIds: [fixture.companyId], actorId: fixture.officeId,
      expectedVersion: Number(priorFollowUp.version),
      reason: "Reassessed for the later service window.",
      deferral: { ...deferral, dueMiles: 12_000, additionalMiles: 2_200, reason: "Reassessed for the later service window." },
      idempotencyKey: `later-deferral-${randomUUID()}`,
    });
    const latestPolicy = (await query("select deferral_policy from inspection_finding_follow_ups where id=$1", [priorFollowUp.id])).rows[0].deferral_policy;
    correction = await inspectionRepository.createInspectionCorrection({
      inspectionId: fixture.sourceInspectionId,
      companyIds: [fixture.companyId],
      expectedVersion: completed.version,
      actorId: fixture.officeId,
      reason: "Clarify completed inspection notes.",
      changes: { finalNotes:"Corrected note; deferred finding is unchanged." },
      idempotencyKey: `correction-${randomUUID()}`,
    });
    assert.equal(correction.lineage?.kind, "correction");
    const effectivePolicy = (await query(
      "select deferral_policy from inspection_finding_follow_ups where company_id=$1 and maintenance_obligation_id=$2 and status<>'superseded'",
      [fixture.companyId, obligationId],
    )).rows[0].deferral_policy;
    assert.deepEqual(effectivePolicy, latestPolicy, "Notes-only corrections preserve the entire latest deferral policy.");
    const rows = await query(
      `select follow_up.status,follow_up.maintenance_obligation_id,follow_up.inspection_id
       from inspection_finding_follow_ups follow_up
       where follow_up.company_id=$1 and follow_up.maintenance_obligation_id=$2 order by follow_up.opened_at,follow_up.id`,
      [fixture.companyId, obligationId],
    );
    assert.equal(rows.rowCount, 2);
    assert.equal(rows.rows.filter((row) => row.status !== "superseded").length, 1);
    assert.equal(rows.rows.find((row) => row.status !== "superseded").inspection_id, correction.id);
    assert.equal(rows.rows.every((row) => row.maintenance_obligation_id === obligationId), true);

    const maintenance = await maintenanceRepository.listInspectionMaintenance({
      companyId: fixture.companyId,
      assetId: fixture.assetId,
      locationIds: [fixture.locationId],
    });
    assert.equal(maintenance.filter((item) => item.id === obligationId && item.inspectionId === correction.id).length, 1);
    const otherTenant = await maintenanceRepository.listInspectionMaintenance({
      companyId: fixture.otherCompanyId,
      assetId: fixture.assetId,
      locationIds: [fixture.locationId],
    });
    assert.deepEqual(otherTenant, []);
  });

  for (const explicitlyChangePolicy of [false, true]) {
    await t.test(explicitlyChangePolicy ? "explicit policy correction adopts corrected trigger" : "finding-note correction preserves later deferral", async () => {
      const currentPolicy = (await query(
        "select deferral_policy from inspection_finding_follow_ups where company_id=$1 and maintenance_obligation_id=$2 and status<>'superseded'",
        [fixture.companyId, obligationId],
      )).rows[0].deferral_policy;
      const correctedDeferral = explicitlyChangePolicy
        ? { ...deferral, dueMiles: 14_000, additionalMiles: 4_200, reason: "Corrected maintenance deadline." }
        : deferral;
      correction = await inspectionRepository.createInspectionCorrection({
        inspectionId: correction.id, companyIds: [fixture.companyId],
        expectedVersion: correction.version, actorId: fixture.officeId,
        reason: "Clarify the deferred checklist finding.",
        changes: { responses: [{ itemKey: "air-leak", response: "issue", naReason: "",
          finding: { severity: "attention", note: "Clarified air leak at fitting.", disposition: "defer", noWorkorderReason: "", deferral: correctedDeferral },
        }] },
        idempotencyKey: `finding-correction-${randomUUID()}`,
      });
      const effectivePolicy = (await query(
        "select deferral_policy from inspection_finding_follow_ups where company_id=$1 and maintenance_obligation_id=$2 and status<>'superseded'",
        [fixture.companyId, obligationId],
      )).rows[0].deferral_policy;
      assert.deepEqual(effectivePolicy, explicitlyChangePolicy ? { ...currentPolicy, ...correctedDeferral } : currentPolicy);
    });
  }

  await t.test("link means planned and workorder cancellation reopens the obligation", async () => {
    const active = (await query(
      `select follow_up.*,finding.id finding_id from inspection_finding_follow_ups follow_up
       join inspection_findings finding on finding.company_id=follow_up.company_id and finding.inspection_id=follow_up.inspection_id and finding.id=follow_up.finding_id
       where follow_up.company_id=$1 and follow_up.maintenance_obligation_id=$2 and follow_up.status<>'superseded'`,
      [fixture.companyId, obligationId],
    )).rows[0];
    const workorderId = randomUUID();
    await query(
      `insert into operational_workorders(id,company_id,serial,asset_id,location_id,created_by_user_id,status,concern)
       values($1,$2,$3,$4,$5,$6,'open','Deferred inspection repair')`,
      [workorderId, fixture.companyId, `WO-${workorderId}`, fixture.assetId, fixture.locationId, fixture.officeId],
    );
    const linked = await inspectionRepository.resolveInspectionFollowUp({
      action: "link_workorder",
      inspectionId: correction.id,
      findingId: active.finding_id,
      companyIds: [fixture.companyId],
      actorId: fixture.officeId,
      expectedVersion: Number(active.version),
      workorderId,
      idempotencyKey: `follow-up-${randomUUID()}`,
    });
    assert.equal(linked.workorderId, workorderId);
    const planned = await maintenanceRepository.listInspectionMaintenance({ companyId:fixture.companyId, assetId:fixture.assetId, locationIds:[fixture.locationId] });
    const plannedItem = planned.find((item) => item.inspectionId === correction.id);
    assert.equal(plannedItem?.workorderId, workorderId);
    assert.equal(evaluateInspectionMaintenance({ deferral:plannedItem.deferral, workorderStatus:plannedItem.workorderStatus }).dueState, "repair_planned");
    assert.equal(evaluateInspectionMaintenance({ deferral:plannedItem.deferral, workorderStatus:"closed" }).dueState, "verification_required");

    await query(
      `update operational_workorders set status='cancelled',cancelled_at=now(),cancelled_by_user_id=$2,cancel_reason='Repair visit cancelled.',updated_at=now() where id=$1`,
      [workorderId, fixture.officeId],
    );
    const reopened = (await query(
      "select status,workorder_id,resolved_at,resolved_by_user_id from inspection_finding_follow_ups where company_id=$1 and maintenance_obligation_id=$2 and status<>'superseded'",
      [fixture.companyId, obligationId],
    )).rows[0];
    assert.equal(reopened.status, "reopened");
    assert.equal(reopened.workorder_id, workorderId);
    assert.equal(reopened.resolved_at, null);
    assert.equal(reopened.resolved_by_user_id, null);
    const reopenEvents = await query(
      "select count(*)::integer count from inspection_finding_follow_up_events where company_id=$1 and follow_up_id=$2 and event_type='reopened' and source_workorder_status='cancelled'",
      [fixture.companyId, active.id],
    );
    assert.equal(reopenEvents.rows[0].count, 1);
  });

  await t.test("standalone browser fixture seeds a completed obligation and a later assigned inspection", async () => {
    const browserFixture = await seedMaintenanceFixture(getPool());
    assert.equal(browserFixture.sourceInspection.status, "completed");
    assert.ok(browserFixture.followUpId);
    assert.ok(browserFixture.maintenanceObligationId);
    assert.equal(browserFixture.mileage.source, "samsara_obd");
    const activeInspection = (await query("select status,started_at from inspections where id=$1", [browserFixture.activeInspectionId])).rows[0];
    assert.deepEqual(activeInspection, { status:"assigned", started_at:null });
    const items = await maintenanceRepository.listInspectionMaintenance({
      companyId: browserFixture.companyId,
      assetId: browserFixture.assetId,
      locationIds: [browserFixture.locationId],
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].id, browserFixture.maintenanceObligationId);
    assert.equal(evaluateInspectionMaintenance({
      deferral: items[0].deferral,
      mileage: browserFixture.mileage,
      sourceCompletedAt: items[0].sourceCompletedAt,
      visitStartedAt: activeInspection.started_at,
    }).dueState, "due_soon");
  });

  await t.test("final-notes correction preserves verified deferred maintenance without reopening a reminder", async () => {
    const verifiedFixture = await seedMaintenanceFixture(getPool());
    const before = (await query(
      "select finding_id,version from inspection_finding_follow_ups where id=$1",
      [verifiedFixture.followUpId],
    )).rows[0];
    const reason = "Repair was inspected and confirmed complete.";
    await inspectionRepository.resolveInspectionFollowUp({
      action: "verify",
      inspectionId: verifiedFixture.sourceInspectionId,
      findingId: before.finding_id,
      companyIds: [verifiedFixture.companyId],
      actorId: verifiedFixture.officeId,
      expectedVersion: Number(before.version),
      reason,
      idempotencyKey: `follow-up-verify-${randomUUID()}`,
    });

    const correction = await inspectionRepository.createInspectionCorrection({
      inspectionId: verifiedFixture.sourceInspectionId,
      companyIds: [verifiedFixture.companyId],
      expectedVersion: verifiedFixture.sourceInspection.version,
      actorId: verifiedFixture.officeId,
      reason: "Clarify final notes without changing verified maintenance.",
      changes: { finalNotes:"Corrected final note; verified repair remains complete." },
      idempotencyKey: `verified-correction-${randomUUID()}`,
    });
    assert.equal(correction.lineage?.kind, "correction");

    const followUps = await query(
      `select id,inspection_id,status,resolution_reason,resolved_at,resolved_by_user_id,maintenance_obligation_id
       from inspection_finding_follow_ups
       where company_id=$1 and maintenance_obligation_id=$2
       order by opened_at,id`,
      [verifiedFixture.companyId, verifiedFixture.maintenanceObligationId],
    );
    assert.equal(followUps.rowCount, 2);
    assert.equal(followUps.rows.filter((row) => row.status !== "superseded").length, 1);
    const effective = followUps.rows.find((row) => row.status !== "superseded");
    assert.equal(effective.inspection_id, correction.id);
    assert.equal(effective.status, "resolved_no_workorder");
    assert.equal(effective.resolution_reason, reason);
    assert.ok(effective.resolved_at);
    assert.equal(effective.resolved_by_user_id, verifiedFixture.officeId);
    assert.equal(followUps.rows.every((row) => row.maintenance_obligation_id === verifiedFixture.maintenanceObligationId), true);

    const verifiedEvents = await query(
      `select event.follow_up_id,count(*)::integer count from inspection_finding_follow_up_events event
       join inspection_finding_follow_ups follow_up on follow_up.company_id=event.company_id and follow_up.id=event.follow_up_id
       where event.company_id=$1 and follow_up.maintenance_obligation_id=$2 and event.event_type='verified'
       group by event.follow_up_id order by event.follow_up_id`,
      [verifiedFixture.companyId, verifiedFixture.maintenanceObligationId],
    );
    assert.equal(verifiedEvents.rowCount, 2);
    assert.equal(verifiedEvents.rows.every((row) => row.count === 1), true);
    const reminders = await maintenanceRepository.listInspectionMaintenance({
      companyId: verifiedFixture.companyId,
      assetId: verifiedFixture.assetId,
      locationIds: [verifiedFixture.locationId],
    });
    assert.deepEqual(reminders, []);
  });
});
