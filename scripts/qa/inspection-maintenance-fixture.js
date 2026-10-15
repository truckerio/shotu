import { createHash, randomUUID } from "node:crypto";
import { saveInspectionResponses, transitionInspection } from "../../src/server/db/repositories/inspections.repo.js";
import { recordProviderAssetMileage } from "../../src/server/db/repositories/asset-mileage.repo.js";

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function companyContext({ actorId, companyId, locationId, role }) {
  return {
    actor: { id:actorId, role },
    companyIds: new Set([companyId]),
    companyRoles: new Map([[companyId, role]]),
    locationIds: new Set(locationId ? [locationId] : []),
  };
}

export async function seedInspectionMaintenanceBase(pool) {
  const fixture = {
    companyId: randomUUID(),
    otherCompanyId: randomUUID(),
    locationId: randomUUID(),
    officeId: randomUUID(),
    mechanicId: randomUUID(),
    otherOfficeId: randomUUID(),
    assetId: randomUUID(),
    templateId: randomUUID(),
    templateVersionId: randomUUID(),
    sourceInspectionId: randomUUID(),
  };
  const template = {
    schemaVersion: 1,
    rendererVersion: "inspection-slip-v1",
    label: "Maintenance integration inspection",
    sections: [{
      key: "general",
      label: "General",
      items: [{ key:"air-leak", label:"Air leak", required:true, allowNa:false, requireNaReason:false }],
    }],
  };
  const run = pool.query.bind(pool);

  await run(
    "insert into companies(id,slug,name) values($1,$2,'Maintenance integration'),($3,$4,'Other tenant')",
    [fixture.companyId, `maintenance-${fixture.companyId}`, fixture.otherCompanyId, `other-${fixture.otherCompanyId}`],
  );
  await run("insert into locations(id,company_id,name) values($1,$2,'Maintenance shop')", [fixture.locationId, fixture.companyId]);
  await run("insert into user_profiles(id,display_name) values($1,'Maintenance office'),($2,'Maintenance mechanic'),($3,'Other tenant office')", [fixture.officeId, fixture.mechanicId, fixture.otherOfficeId]);
  await run(
    "insert into user_company_memberships(user_id,company_id,role) values($1,$3,'office'),($2,$3,'mechanic')",
    [fixture.officeId, fixture.mechanicId, fixture.companyId],
  );
  await run("insert into user_company_memberships(user_id,company_id,role) values($1,$2,'office')", [fixture.otherOfficeId, fixture.otherCompanyId]);
  await run(
    "insert into user_location_memberships(user_id,location_id,company_id) values($1,$3,$4),($2,$3,$4)",
    [fixture.officeId, fixture.mechanicId, fixture.locationId, fixture.companyId],
  );
  await run(
    `insert into assets(id,company_id,location_id,provider,unit_type,unit_no,name)
     values($1,$2,$3,'manual','Truck','QA-MAINT-1','Maintenance truck')`,
    [fixture.assetId, fixture.companyId, fixture.locationId],
  );
  await run(
    `insert into template_definitions(id,company_id,family_key,applicability_key,name,created_by_user_id)
     values($1,$2,'inspection','Truck','Maintenance integration template',$3)`,
    [fixture.templateId, fixture.companyId, fixture.officeId],
  );
  await run(
    `insert into template_versions(id,company_id,template_id,version_number,state,family_schema_version,renderer_version,definition,definition_sha256,published_by_user_id,published_at,created_by_user_id)
     values($1,$2,$3,1,'published',1,'inspection-slip-v1',$4::jsonb,$5,$6,now(),$6)`,
    [fixture.templateVersionId, fixture.companyId, fixture.templateId, JSON.stringify(template), digest(template), fixture.officeId],
  );
  await run(
    `insert into template_assignments(company_id,location_id,family_key,applicability_key,template_version_id,updated_by_user_id)
     values($1,$2,'inspection','Truck',$3,$4)`,
    [fixture.companyId, fixture.locationId, fixture.templateVersionId, fixture.officeId],
  );
  await run("insert into inspection_serial_counters(company_id,prefix,next_number,digits) values($1,'INS-',3,6)", [fixture.companyId]);
  await run(
    `insert into inspections(id,company_id,location_id,asset_id,inspection_number,inspection_kind,unit_type,status,version,
      template_version_id,template_snapshot,template_snapshot_sha256,asset_snapshot,requested_by_user_id,requested_at,started_at,
      odometer_miles,previous_report_reviewed,start_evidence_recorded_at)
     values($1,$2,$3,$4,'INS-000001','weekly_truck','Truck','in_progress',1,$5,$6::jsonb,$7,$8::jsonb,$9,now()-interval '1 hour',now()-interval '50 minutes',9800,true,now()-interval '50 minutes')`,
    [fixture.sourceInspectionId, fixture.companyId, fixture.locationId, fixture.assetId, fixture.templateVersionId, JSON.stringify(template), digest(template), JSON.stringify({ unitNo:"QA-MAINT-1", name:"Maintenance truck" }), fixture.officeId],
  );
  await run(
    `insert into inspection_assignments(company_id,inspection_id,mechanic_user_id,assignment_role,assigned_by_user_id)
     values($1,$2,$3,'primary',$4)`,
    [fixture.companyId, fixture.sourceInspectionId, fixture.mechanicId, fixture.officeId],
  );
  await run(
    `insert into inspection_events(company_id,inspection_id,event_type,from_status,to_status,actor_id,version,details)
     values($1,$2,'started','assigned','in_progress',$3,1,'{}')`,
    [fixture.companyId, fixture.sourceInspectionId, fixture.mechanicId],
  );

  return {
    ...fixture,
    template,
    officeContext: companyContext({ actorId:fixture.officeId, companyId:fixture.companyId, locationId:fixture.locationId, role:"office" }),
    mechanicContext: companyContext({ actorId:fixture.mechanicId, companyId:fixture.companyId, locationId:fixture.locationId, role:"mechanic" }),
    otherTenantContext: companyContext({ actorId:fixture.otherOfficeId, companyId:fixture.otherCompanyId, role:"office" }),
  };
}

export async function seedMaintenanceFixture(pool) {
  const fixture = await seedInspectionMaintenanceBase(pool);
  const deferral = {
    reason: "Safe to repair during the next service window.",
    nextVisit: true,
    dueDate: null,
    dueMiles: 10_000,
    baselineMiles: 9_800,
    additionalMiles: 200,
    earlyMiles: 200,
  };
  const saved = await saveInspectionResponses({
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
  }, { pool });
  const completed = await transitionInspection({
    inspectionId: fixture.sourceInspectionId,
    companyIds: [fixture.companyId],
    expectedVersion: saved.version,
    toStatus: "completed",
    finalNotes: "Deferred issue recorded.",
    actorId: fixture.mechanicId,
    completionAuthority: "primary_mechanic",
  }, { pool });
  const followUp = (await pool.query(
    `select follow_up.*,finding.id finding_id from inspection_finding_follow_ups follow_up
     join inspection_findings finding on finding.company_id=follow_up.company_id and finding.inspection_id=follow_up.inspection_id and finding.id=follow_up.finding_id
     where follow_up.company_id=$1 and follow_up.inspection_id=$2`,
    [fixture.companyId, fixture.sourceInspectionId],
  )).rows[0];

  const activeInspectionId = randomUUID();
  await pool.query(
    `insert into inspections(id,company_id,location_id,asset_id,inspection_number,inspection_kind,unit_type,status,version,
      template_version_id,template_snapshot,template_snapshot_sha256,asset_snapshot,requested_by_user_id,requested_at)
     values($1,$2,$3,$4,'INS-000002','weekly_truck','Truck','assigned',1,$5,$6::jsonb,$7,$8::jsonb,$9,now())`,
    [activeInspectionId, fixture.companyId, fixture.locationId, fixture.assetId, fixture.templateVersionId, JSON.stringify(fixture.template), digest(fixture.template), JSON.stringify({ unitNo:"QA-MAINT-1", name:"Maintenance truck" }), fixture.officeId],
  );
  await pool.query(
    `insert into inspection_assignments(company_id,inspection_id,mechanic_user_id,assignment_role,assigned_by_user_id)
     values($1,$2,$3,'primary',$4)`,
    [fixture.companyId, activeInspectionId, fixture.mechanicId, fixture.officeId],
  );
  await pool.query(
    `insert into inspection_events(company_id,inspection_id,event_type,from_status,to_status,actor_id,version,details)
     values($1,$2,'created',null,'assigned',$3,1,'{}')`,
    [fixture.companyId, activeInspectionId, fixture.officeId],
  );
  const mileage = await recordProviderAssetMileage({
    assetId: fixture.assetId,
    companyId: fixture.companyId,
    miles: 9_800,
    observedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    source: "samsara_obd",
    providerPayload: { fixture:true },
  }, { pool });

  return {
    ...fixture,
    deferral,
    sourceInspection: completed,
    sourceFindingId: followUp.finding_id,
    followUpId: followUp.id,
    maintenanceObligationId: followUp.maintenance_obligation_id,
    activeInspectionId,
    mileage,
  };
}
