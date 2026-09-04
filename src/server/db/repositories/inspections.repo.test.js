import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createInspection, createInspectionCorrection, createInspectionReinspection, createInspectionWorkorder, inspectionRepositoryInternals, listInspections, listWorkorderInspectionSources, replaceInspectionAssignments, resolveInspectionFollowUp, transitionInspection } from "./inspections.repo.js";
import { ensureInspectionPrintArchiveInTransaction, recordInspectionPrintLegacyAcceptance } from "./inspection-print-archives.repo.js";
import { inspectionPrintSnapshotDigest } from "../../modules/inspections/inspection-print-integrity.js";

const completed = {
  id: "inspection-1",
  company_id: "company-1",
  location_id: "location-1",
  inspection_number: "INS-1",
  status: "completed",
  result: "issues_found",
  completed_at: "2026-09-02T12:00:00.000Z",
  asset_snapshot: { unitNo: "T-1" },
  template_snapshot: { label: "Weekly Truck Inspection", sections: [] },
  final_notes: "",
};

function archivedWorkorderFlag(findings = [], workorderLinks = []) {
  return inspectionRepositoryInternals.archiveSnapshot(completed, [], findings, workorderLinks).snapshot.workordersLinked;
}

test("completed archive reports workorder links only when persisted link evidence exists", () => {
  assert.equal(archivedWorkorderFlag(), false, "a passed inspection has no workorder link");
  assert.equal(archivedWorkorderFlag([{ disposition: "office_follow_up" }]), false);
  assert.equal(archivedWorkorderFlag([{ disposition: "no_workorder" }]), false);
  assert.equal(archivedWorkorderFlag([{ disposition: "new_workorder" }]), false, "a disposition alone is not link evidence");
  assert.equal(archivedWorkorderFlag([{ disposition: "new_workorder" }], [{ finding_id: "finding-1" }]), true);
});

test("completed archive normalizes PostgreSQL Date values before hashing or persistence", () => {
  const snapshot = inspectionRepositoryInternals.archiveSnapshot({
    ...completed,
    completed_at:new Date("2026-09-02T12:00:00.000Z"),
  }, [], []).snapshot;
  assert.equal(snapshot.completedAt,"2026-09-02T12:00:00.000Z");
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)),snapshot);
});

test("completed archive preserves prior-report availability beside recorded review evidence", () => {
  const snapshot=inspectionRepositoryInternals.archiveSnapshot({...completed,unit_type:"Truck",start_evidence_recorded_at:"2026-09-03T10:00:00Z",odometer_miles:"123",previous_report_reviewed:true,previous_report_available:true},[],[]).snapshot;
  assert.equal(snapshot.previousReportAvailable,true);
  assert.equal(snapshot.startEvidence.previousReportReviewed,true);
});

test("legacy print acceptance audit uses an idempotent archive-scoped insert", async () => {
  let statement; let values;
  await recordInspectionPrintLegacyAcceptance({
    companyId:"company-1",inspectionId:"inspection-1",archiveId:"archive-1",
    legacyFormat:"completed_at_date_empty_object_v1",storedSnapshotSha256:"a".repeat(64),
    canonicalSnapshotSha256:"b".repeat(64),actorId:"user-1",
  }, { query:async(sql,input)=>(statement=sql,values=input,{rows:[]}) });
  assert.match(statement,/on conflict\(company_id,archive_id,legacy_format\) do nothing/);
  assert.deepEqual(values,["company-1","inspection-1","archive-1","completed_at_date_empty_object_v1","a".repeat(64),"b".repeat(64),"user-1"]);
});

test("archive persistence defensively normalizes Date and rejects a caller digest mismatch", async () => {
  const snapshot={completedAt:new Date("2026-09-02T12:00:00.000Z"),html:"<html>x</html>"};
  const normalized={completedAt:"2026-09-02T12:00:00.000Z",html:"<html>x</html>"};
  const calls=[];
  const client={query:async(sql,values)=>{
    calls.push({sql,values});
    if(sql.startsWith("select * from inspection_print_archives"))return{rows:[]};
    if(sql.startsWith("insert into inspection_print_archives"))return{rows:[{id:"archive-1",company_id:"company-1",inspection_id:"inspection-1",revision_number:1,status:"ready",snapshot:normalized,snapshot_sha256:inspectionPrintSnapshotDigest(normalized)}]};
    return{rows:[]};
  }};
  await ensureInspectionPrintArchiveInTransaction({companyId:"company-1",inspectionId:"inspection-1",locationId:"location-1",inspectionNumber:"INS-1",actorId:"user-1",idempotencyKey:"inspection-complete-1",requestSha256:"a".repeat(64),snapshot,snapshotSha256:inspectionPrintSnapshotDigest(normalized),documentSha256:"b".repeat(64),documentByteSize:14},client);
  const insert=calls.find((call)=>call.sql.startsWith("insert into inspection_print_archives"));
  assert.deepEqual(JSON.parse(insert.values[8]),normalized);

  let queried=false;
  await assert.rejects(ensureInspectionPrintArchiveInTransaction({companyId:"company-1",inspectionId:"inspection-1",snapshot,snapshotSha256:"0".repeat(64)}, {query:async()=>{queried=true;}}), (error)=>error.statusCode===409&&error.code==="INSPECTION_PRINT_ARCHIVE_DIGEST_MISMATCH");
  assert.equal(queried,false);
});

test("inspection queue summary reports persisted answer progress", () => {
  const summary = inspectionRepositoryInternals.publicSummary({
    id: "inspection-1",
    version: 3,
    answered_count: "12",
    defect_count: "1",
    template_snapshot: { sections: [{ items: [{ key: "a" }, { key: "b" }] }] },
  });
  assert.deepEqual(summary.progress, { answered: 12, total: 2, issues: 1 });
});

test("inspection summary exposes an authorization-safe reinspection blocker",()=>{
  const blocked=inspectionRepositoryInternals.publicSummary({id:"inspection-1",version:1,status:"completed",result:"passed",reinspection_blocker_code:"source_passed"});
  assert.equal(blocked.reinspectionEligible,false);
  assert.equal(blocked.reinspectionBlockerCode,"source_passed");
  const eligible=inspectionRepositoryInternals.publicSummary({id:"inspection-2",version:1,status:"completed",result:"issues_found",reinspection_blocker_code:null});
  assert.equal(eligible.reinspectionEligible,true);
  assert.equal(eligible.reinspectionBlockerCode,null);
  const detail=inspectionRepositoryInternals.publicDetail({...eligible,reinspection_blocker_code:null});
  assert.equal(detail.reinspectionEligible,true);
  for(const code of ["not_completed","source_passed","follow_up_open","repair_incomplete","active_inspection_exists","template_unavailable"])assert.match(inspectionRepositoryInternals.reinspectionBlockerSql,new RegExp(`'${code}'`));
});

test("inspection detail exposes bounded truck start evidence but never trailer readings",()=>{const truck=inspectionRepositoryInternals.publicDetail({id:"truck",version:2,status:"in_progress",unit_type:"Truck",start_evidence_recorded_at:"2026-09-03T12:00:00Z",odometer_miles:"12345.6",engine_hours:"789.1",previous_report_reviewed:true,previous_report_available:true});assert.deepEqual(truck.startEvidence,{odometerMiles:12345.6,engineHours:789.1,previousReportReviewed:true});assert.equal(truck.previousReportAvailable,true);const trailer=inspectionRepositoryInternals.publicDetail({id:"trailer",version:2,status:"in_progress",unit_type:"Trailer",start_evidence_recorded_at:"2026-09-03T12:00:00Z",odometer_miles:"999",engine_hours:"8",previous_report_reviewed:false,previous_report_available:false});assert.equal(trailer.startEvidence,null);assert.equal(trailer.previousReportAvailable,false);});

test("workorder inspection sources reuse canonical blockers and preserve deterministic newest-first order",async()=>{let statement;let values;const rows=[{id:"inspection-new",inspection_number:"INS-20",completed_at:"2026-09-03T12:00:00Z",result:"issues_found",reinspection_blocker_code:null},{id:"inspection-old",inspection_number:"INS-10",completed_at:"2026-09-02T12:00:00Z",result:"passed",reinspection_blocker_code:"source_passed"}];const sources=await listWorkorderInspectionSources({companyId:"company",locationId:"location",workorderId:"workorder"},{query:async(sql,input)=>(statement=sql,values=input,{rows})});assert.deepEqual(values,["company","location","workorder",false,null]);assert.match(statement,new RegExp(inspectionRepositoryInternals.reinspectionBlockerSql.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));assert.match(statement,/exists\(select 1 from inspection_workorder_links[\s\S]*link\.workorder_id=\$3\)/);assert.match(statement,/inspection_assignments[\s\S]*mechanic_user_id=\$5/);assert.match(statement,/order by inspection\.completed_at desc,inspection\.id desc/);assert.deepEqual(sources.map((source)=>source.inspectionId),["inspection-new","inspection-old"]);assert.deepEqual(sources[0],{inspectionId:"inspection-new",inspectionNumber:"INS-20",completedAt:"2026-09-03T12:00:00Z",result:"issues_found",eligible:true,blockerCode:null,blockerMessage:null});assert.equal(sources[1].eligible,false);assert.equal(sources[1].blockerCode,"source_passed");assert.match(sources[1].blockerMessage,/passed/i);});

test("workorder inspection source query returns an empty bounded context without widening tenant scope",async()=>{let values;const sources=await listWorkorderInspectionSources({companyId:"company-a",locationId:"location-a",workorderId:"workorder-a",restrictToActor:true,actorId:"mechanic-a"},{query:async(_sql,input)=>(values=input,{rows:[]})});assert.deepEqual(sources,[]);assert.deepEqual(values,["company-a","location-a","workorder-a",true,"mechanic-a"]);});
test("workorder inspection source query preserves one linked ineligible choice",async()=>{const sources=await listWorkorderInspectionSources({companyId:"company",locationId:"location",workorderId:"workorder"},{query:async()=>({rows:[{id:"inspection",inspection_number:"INS-1",completed_at:"2026-09-03T12:00:00Z",result:"issues_found",reinspection_blocker_code:"repair_incomplete"}]})});assert.equal(sources.length,1);assert.equal(sources[0].eligible,false);assert.equal(sources[0].blockerCode,"repair_incomplete");assert.match(sources[0].blockerMessage,/repair/i);});

const createInput={companyId:"11111111-1111-4111-8111-111111111111",locationId:"22222222-2222-4222-8222-222222222222",assetId:"33333333-3333-4333-8333-333333333333",actorId:"44444444-4444-4444-8444-444444444444",mechanicUserIds:[],idempotencyKey:"inspection-create-001",officeInstructions:"",startImmediately:false};
const activeInspectionRow={id:"55555555-5555-4555-8555-555555555555",company_id:createInput.companyId,location_id:createInput.locationId,asset_id:createInput.assetId,inspection_number:"INS-1",inspection_kind:"weekly_truck",unit_type:"Truck",status:"requested",version:1,template_snapshot:{sections:[]},asset_snapshot:{unitNo:"T-1"}};

test("ordinary creation cannot bypass the explicit start-evidence action",async()=>{let reserveCalls=0;const client={async query(sql){if(["begin","rollback"].includes(sql))return{rows:[]};throw new Error(`Unexpected query: ${sql}`);},release(){}};await assert.rejects(createInspection({...createInput,startImmediately:true},{pool:{connect:async()=>client},reserveSerial:async()=>{reserveCalls+=1;return"INS-2";}}),(error)=>error.code==="INSPECTION_START_EVIDENCE_REQUIRED");assert.equal(reserveCalls,0);});

test("inspection creation exact replay returns its original inspection and changed payload conflicts",async()=>{const requestSha256=inspectionRepositoryInternals.inspectionCreateRequestHash(createInput);let queries=0;const client={async query(sql){queries+=1;if(sql.startsWith("select inspection_id"))return{rows:[{inspection_id:activeInspectionRow.id,request_sha256:requestSha256}]};if(sql.includes("from inspections inspection"))return{rows:[activeInspectionRow]};return{rows:[]};},release(){}};const replay=await createInspection(createInput,{pool:{connect:async()=>client},reserveSerial:async()=>assert.fail("replay must not reserve a serial")});assert.equal(replay.id,activeInspectionRow.id);assert.ok(queries>=4);await assert.rejects(createInspection({...createInput,officeInstructions:"changed"},{pool:{connect:async()=>client},reserveSerial:async()=>assert.fail()}),(error)=>error.statusCode===409&&error.code==="INSPECTION_CREATE_IDEMPOTENCY_CONFLICT");});

test("different creation key opens the active family before reserving a serial",async()=>{let reserveCalls=0;let commandRecorded=false;const client={async query(sql){if(sql.startsWith("select inspection_id"))return{rows:[]};if(sql.startsWith("select asset.*"))return{rows:[{id:createInput.assetId,company_id:createInput.companyId,unit_type:"Truck"}]};if(sql.startsWith("select id from inspections"))return{rows:[{id:activeInspectionRow.id}]};if(sql.startsWith("insert into inspection_create_commands")){commandRecorded=true;return{rows:[]};}if(sql.includes("from inspections inspection"))return{rows:[activeInspectionRow]};return{rows:[]};},release(){}};const result=await createInspection({...createInput,idempotencyKey:"inspection-create-002"},{pool:{connect:async()=>client},reserveSerial:async()=>{reserveCalls+=1;return"INS-2";}});assert.equal(result.id,activeInspectionRow.id);assert.equal(reserveCalls,0);assert.equal(commandRecorded,true);});

test("inspection creation blocks missing assignment without reserving a serial",async()=>{let reserveCalls=0;const client={async query(sql){if(["begin","rollback"].includes(sql)||sql.startsWith("select pg_advisory"))return{rows:[]};if(sql.startsWith("select inspection_id"))return{rows:[]};if(sql.startsWith("select asset.*"))return{rows:[{id:createInput.assetId,company_id:createInput.companyId,unit_type:"Truck"}]};if(sql.startsWith("select id from inspections"))return{rows:[]};throw new Error(`Unexpected query: ${sql}`);},release(){}};await assert.rejects(createInspection({...createInput,idempotencyKey:"inspection-create-no-template"},{pool:{connect:async()=>client},resolveTemplate:async()=>null,reserveSerial:async()=>{reserveCalls+=1;return"INS-2";}}),(error)=>error.statusCode===409&&error.code==="INSPECTION_TEMPLATE_UNAVAILABLE");assert.equal(reserveCalls,0);});

test("active-family unique race rolls back and deterministically maps the command to the winner",async()=>{let activeChecks=0;let reserveCalls=0;const unique=Object.assign(new Error("duplicate"),{code:"23505",constraint:"inspections_one_active_weekly_uidx"});const client={async query(sql){if(sql.startsWith("select inspection_id"))return{rows:[]};if(sql.startsWith("select asset.*"))return{rows:[{id:createInput.assetId,company_id:createInput.companyId,unit_type:"Truck"}]};if(sql.startsWith("select id from inspections")){activeChecks+=1;return{rows:activeChecks===1?[]:[{id:activeInspectionRow.id}]};}if(sql.startsWith("insert into inspections"))throw unique;if(sql.includes("from inspections inspection"))return{rows:[activeInspectionRow]};return{rows:[]};},release(){}};const result=await createInspection({...createInput,idempotencyKey:"inspection-create-race"},{pool:{connect:async()=>client},resolveTemplate:async()=>({id:"template-1",definition:{sections:[]}}),reserveSerial:async()=>{reserveCalls+=1;return"INS-2";}});assert.equal(result.id,activeInspectionRow.id);assert.equal(activeChecks,2);assert.equal(reserveCalls,1);});

test("repository rejects stale completion authority and zero-primary in-progress reassignment",async()=>{const inspection={...activeInspectionRow,status:"in_progress",template_snapshot:{sections:[]}};const client={async query(sql){if(sql.includes("from inspections inspection"))return{rows:[inspection]};if(sql.startsWith("select 1 from inspection_assignments"))return{rows:[]};return{rows:[]};},release(){}};await assert.rejects(transitionInspection({inspectionId:inspection.id,companyIds:[inspection.company_id],expectedVersion:1,toStatus:"completed",actorId:createInput.actorId,completionAuthority:"primary_mechanic",details:{}},{pool:{connect:async()=>client}}),(error)=>error.code==="INSPECTION_PRIMARY_REQUIRED");await assert.rejects(replaceInspectionAssignments({inspectionId:inspection.id,companyIds:[inspection.company_id],expectedVersion:1,mechanicUserIds:[],actorId:createInput.actorId},{pool:{connect:async()=>client}}),(error)=>error.code==="INSPECTION_PRIMARY_REQUIRED");});

test("truck start stores evidence atomically and event details contain presence only",async()=>{const before={...activeInspectionRow,status:"assigned",requested_at:"2026-09-03T10:00:00Z"};let eventDetails;const client={async query(sql,values){if(sql.startsWith("select inspection.*")&&!sql.includes(" as location"))return{rows:[before]};if(sql.startsWith("select exists(select 1 from inspections prior"))return{rows:[{previous_report_available:false}]};if(sql.startsWith("update inspections set"))return{rows:[{...before,status:"in_progress",version:2,started_at:"2026-09-03T11:00:00Z",odometer_miles:"120003.4",engine_hours:"8321.2",previous_report_reviewed:false,start_evidence_recorded_at:"2026-09-03T11:00:00Z"}]};if(sql.startsWith("insert into inspection_events")){eventDetails=JSON.parse(values[7]);return{rows:[]};}if(sql.includes("from inspections inspection"))return{rows:[{...before,status:"in_progress",version:2,unit_type:"Truck",odometer_miles:"120003.4",engine_hours:"8321.2",previous_report_reviewed:false,start_evidence_recorded_at:"2026-09-03T11:00:00Z",previous_report_available:false}]};return{rows:[]};},release(){}};const started=await transitionInspection({inspectionId:before.id,companyIds:[before.company_id],expectedVersion:1,toStatus:"in_progress",actorId:createInput.actorId,odometerMiles:120003.4,engineHours:8321.2,previousReportReviewed:false},{pool:{connect:async()=>client}});assert.deepEqual(started.startEvidence,{odometerMiles:120003.4,engineHours:8321.2,previousReportReviewed:false});assert.deepEqual(eventDetails,{startEvidence:{odometerMilesPresent:true,engineHoursPresent:true,previousReportReviewedPresent:true}});assert.equal(JSON.stringify(eventDetails).includes("120003"),false);});

test("start enforces prior-report review and rejects trailer readings",async()=>{const truck={...activeInspectionRow,status:"assigned",requested_at:"2026-09-03T10:00:00Z"};const priorClient={async query(sql){if(sql.startsWith("select inspection.*"))return{rows:[truck]};if(sql.startsWith("select exists(select 1 from inspections prior"))return{rows:[{previous_report_available:true}]};return{rows:[]};},release(){}};await assert.rejects(transitionInspection({inspectionId:truck.id,companyIds:[truck.company_id],expectedVersion:1,toStatus:"in_progress",actorId:createInput.actorId,odometerMiles:12,previousReportReviewed:false},{pool:{connect:async()=>priorClient}}),(error)=>error.code==="INSPECTION_PREVIOUS_REPORT_REVIEW_REQUIRED");const trailer={...truck,unit_type:"Trailer",inspection_kind:"weekly_trailer"};const trailerClient={async query(sql){if(sql.startsWith("select inspection.*"))return{rows:[trailer]};return{rows:[]};},release(){}};await assert.rejects(transitionInspection({inspectionId:trailer.id,companyIds:[trailer.company_id],expectedVersion:1,toStatus:"in_progress",actorId:createInput.actorId,odometerMiles:1,previousReportReviewed:false},{pool:{connect:async()=>trailerClient}}),(error)=>error.code==="INSPECTION_TRAILER_READINGS_UNSUPPORTED");});

test("inspection completion gives its shared service-history identifier one PostgreSQL type", async () => {
  const source = await readFile(new URL("inspections.repo.js", import.meta.url), "utf8");
  assert.match(source, /values\(\$1,'local_inspection',\$2::uuid::text,[\s\S]*'verified_completed',\$2::uuid\)/);
  assert.doesNotMatch(source, /values\(\$1,'local_inspection',\$2,\$3,[\s\S]*'verified_completed',\$2::uuid\)/);
});

test("inspection completion gives shared service-history line ordering one PostgreSQL type", async () => {
  const source = await readFile(new URL("inspections.repo.js", import.meta.url), "utf8");
  assert.match(source, /values\(\$1,\$2,\$3,\$4::integer::numeric,\$4::integer,'service'/);
  assert.doesNotMatch(source, /values\(\$1,\$2,\$3,\$4,\$4,'service'/);
});

test("inspection workorder creation maps the one-active-unit constraint to a public conflict", async () => {
  const activeConflict = Object.assign(new Error("Asset already has an active workorder."), {
    code: "23505",
    constraint: "operational_workorders_one_active_per_asset_uidx",
  });
  const inspection = {
    id: "22222222-2222-4222-8222-222222222222",
    company_id: "11111111-1111-4111-8111-111111111111",
    location_id: "33333333-3333-4333-8333-333333333333",
    asset_id: "44444444-4444-4444-8444-444444444444",
    inspection_number: "INS-1",
    status: "in_progress",
    version: 2,
    asset_snapshot: {},
  };
  const client = {
    async query(sql) {
      if (sql === "rollback" || sql === "begin" || sql.startsWith("select pg_advisory")) return { rows: [] };
      if (sql.includes("from inspections inspection")) return { rows: [inspection] };
      if (sql.includes("from inspection_workorder_create_commands")) return { rows: [] };
      if (sql.startsWith("select * from inspection_findings")) return { rows:[{ id:"55555555-5555-4555-8555-555555555555", disposition:"new_workorder", note:"Tire damage" }], rowCount:1 };
      if (sql.startsWith("select 1 from inspection_workorder_links")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {},
  };
  await assert.rejects(createInspectionWorkorder({
    inspectionId:inspection.id,
    companyIds:[inspection.company_id],
    expectedVersion:2,
    findingIds:["55555555-5555-4555-8555-555555555555"],
    actorId:"66666666-6666-4666-8666-666666666666",
    idempotencyKey:"inspection-create-active-conflict",
  }, {
    pool:{ connect:async()=>client },
    createWorkorder:async()=>{ throw activeConflict; },
  }), (error) => error.statusCode === 409
    && error.code === "ASSET_ACTIVE_WORKORDER_EXISTS"
    && /already has an active workorder/i.test(error.message));
});

test("needs-action queue includes completed inspections only while a durable obligation is open",async()=>{let statement;let values;await listInspections({companyIds:[createInput.companyId],locationIds:[createInput.locationId],statuses:null,search:"",limit:25,restrictedMechanicCompanyIds:[],actorId:createInput.actorId,needsAction:true},{query:async(sql,input)=>(statement=sql,values=input,{rows:[]})});assert.equal(values[12],true);assert.match(statement,/inspection\.status='completed'[\s\S]*action\.status in \('open','reopened'\)/);});

test("mechanic list exposes unassigned requested inspections without exposing another mechanic's active work",async()=>{let statement;let values;await listInspections({companyIds:[createInput.companyId],locationIds:[createInput.locationId],statuses:["requested","assigned","in_progress"],search:"",limit:25,restrictedMechanicCompanyIds:[createInput.companyId],actorId:createInput.actorId,needsAction:false},{query:async(sql,input)=>(statement=sql,values=input,{rows:[]})});assert.equal(values[10][0],createInput.companyId);assert.equal(values[11],createInput.actorId);assert.match(statement,/inspection\.status='requested'[\s\S]*not exists[\s\S]*available_assignment/);assert.match(statement,/restricted_assignment\.mechanic_user_id=\$12::uuid[\s\S]*restricted_assignment\.active/);});

test("follow-up no-workorder command is atomic, exactly replayable, and rejects changed payload",async()=>{
  const inspection={...activeInspectionRow,status:"completed",version:4};const findingId="66666666-6666-4666-8666-666666666666";const followUp={id:"77777777-7777-4777-8777-777777777777",company_id:inspection.company_id,inspection_id:inspection.id,finding_id:findingId,status:"open",version:1,note:"Observe tire"};let command;
  function client(replay=null){return{async query(sql,values){if(["begin","commit","rollback"].includes(sql)||sql.startsWith("select pg_advisory"))return{rows:[]};if(sql.includes("from inspections inspection"))return{rows:[inspection]};if(sql.includes("from inspection_follow_up_commands"))return{rows:replay?[replay]:[]};if(sql.includes("from inspection_finding_follow_ups follow_up"))return{rows:[followUp]};if(sql.startsWith("update inspection_finding_follow_ups"))return{rows:[{...followUp,status:"resolved_no_workorder",version:2}]};if(sql.startsWith("insert into inspection_finding_follow_up_events"))return{rows:[]};if(sql.startsWith("insert into inspection_follow_up_commands")){command={request_sha256:values[5],workorder_id:null,inspection_id:inspection.id};return{rows:[]};}throw new Error(`Unexpected query: ${sql}`);},release(){}};}
  const input={inspectionId:inspection.id,findingId,companyIds:[inspection.company_id],actorId:createInput.actorId,action:"no_workorder",expectedVersion:1,idempotencyKey:"follow-up-none-atomic",reason:"No repair is required"};
  const first=await resolveInspectionFollowUp(input,{pool:{connect:async()=>client()}});assert.equal(first.replayed,false);assert.equal(first.inspection.status,"completed");assert.ok(command?.request_sha256);
  const replayed=await resolveInspectionFollowUp(input,{pool:{connect:async()=>client(command)}});assert.equal(replayed.replayed,true);
  await assert.rejects(resolveInspectionFollowUp({...input,reason:"Changed reason"},{pool:{connect:async()=>client(command)}}),(error)=>error.statusCode===409&&error.code==="INSPECTION_FOLLOW_UP_IDEMPOTENCY_CONFLICT");
});

test("completion persists obligation and opened event inside its transaction before commit",async()=>{const source=await readFile(new URL("inspections.repo.js",import.meta.url),"utf8");assert.match(source,/for\(const finding of findings\.rows\.filter\(\(entry\)=>entry\.disposition==="office_follow_up"\)\)[\s\S]*insert into inspection_finding_follow_ups[\s\S]*insert into inspection_finding_follow_up_events[\s\S]*await client\.query\("commit"\)/);});

test("correction copies immutable evidence and refreshes one source service-history occurrence",async()=>{const source=await readFile(new URL("inspections.repo.js",import.meta.url),"utf8");const correction=source.slice(source.indexOf("export async function createInspectionCorrection"),source.indexOf("export async function createInspectionReinspection"));assert.match(correction,/lineage_kind[\s\S]*'correction'/);assert.match(correction,/odometer_miles,engine_hours,previous_report_reviewed,start_evidence_recorded_at/);assert.match(correction,/before\.odometer_miles,before\.engine_hours,before\.previous_report_reviewed,before\.start_evidence_recorded_at/);assert.match(correction,/insert into inspection_responses[\s\S]*select/);assert.match(correction,/insert into inspection_findings[\s\S]*select/);assert.match(correction,/update service_history_orders[\s\S]*latestCorrectionInspectionId/);assert.match(correction,/source_observation_inspection_id\|\|before\.id/);assert.match(correction,/delete from service_history_lines[\s\S]*insert into service_history_lines/);assert.match(correction,/archiveCompletedInspection/);assert.doesNotMatch(correction,/insert into service_history_orders/);});

test("reinspection uses only a current assigned published template and starts with blank answers",async()=>{const source=await readFile(new URL("inspections.repo.js",import.meta.url),"utf8");const reinspection=source.slice(source.indexOf("export async function createInspectionReinspection"),source.indexOf("export async function createInspectionWorkorder"));assert.match(reinspection,/resolvePublishedTemplateForInspection[\s\S]*actorId:null/);assert.match(reinspection,/INSPECTION_REINSPECTION_TEMPLATE_UNAVAILABLE/);assert.match(reinspection,/status in \('closed','odoo_entered'\)/);assert.match(reinspection,/inspection_reinspection_commands/);assert.doesNotMatch(reinspection,/insert into inspection_responses/);assert.doesNotMatch(reinspection,/insert into service_history_orders/);});

test("typed lineage ledgers replay exactly and reject a reused key with a changed request",async()=>{const requestSha256="a".repeat(64);const row={...activeInspectionRow,lineage_kind:"reinspection",predecessor_inspection_id:"source",source_observation_inspection_id:"observation"};const client={async query(sql){if(sql.includes("from inspection_reinspection_commands"))return{rows:[{reinspection_id:row.id,request_sha256:requestSha256}]};if(sql.includes("from inspections inspection"))return{rows:[row]};throw new Error(`Unexpected query: ${sql}`);}};const input={companyIds:[row.company_id],actorId:createInput.actorId,idempotencyKey:"typed-lineage-replay"};const replay=await inspectionRepositoryInternals.typedReplay(client,"inspection_reinspection_commands","reinspection_id",row.company_id,input,requestSha256);assert.equal(replay.id,row.id);await assert.rejects(inspectionRepositoryInternals.typedReplay(client,"inspection_reinspection_commands","reinspection_id",row.company_id,input,"b".repeat(64)),(error)=>error.statusCode===409&&error.code==="INSPECTION_LINEAGE_IDEMPOTENCY_CONFLICT");});

test("passed source is rejected by the repository before reinspection creation",async()=>{
  const passed={...activeInspectionRow,status:"completed",result:"passed",completed_at:"2026-09-03T12:00:00.000Z"};
  const client={async query(sql){if(["begin","commit","rollback"].includes(sql)||sql.startsWith("select pg_advisory"))return{rows:[]};if(sql.includes("from inspections inspection"))return{rows:[passed]};if(sql.includes("from inspection_reinspection_commands"))return{rows:[]};if(sql.startsWith("select id from inspection_events"))return{rows:[{id:"event-1"}]};throw new Error(`Unexpected query: ${sql}`);},release(){}};
  await assert.rejects(createInspectionReinspection({inspectionId:passed.id,companyIds:[passed.company_id],expectedVersion:1,actorId:createInput.actorId,reason:"Verify condition",mechanicUserIds:[],startImmediately:false,idempotencyKey:"reinspect-passed-source"},{pool:{connect:async()=>client}}),(error)=>error.statusCode===409&&error.code==="INSPECTION_REINSPECTION_SOURCE_PASSED");
});

test("reinspection rejects a source superseded by a correction",async()=>{
  const source={...activeInspectionRow,status:"completed",result:"issues_found",completed_at:"2026-09-03T12:00:00.000Z"};
  const client={async query(sql){if(["begin","commit","rollback"].includes(sql)||sql.startsWith("select pg_advisory"))return{rows:[]};if(sql.includes("from inspections inspection"))return{rows:[source]};if(sql.includes("from inspection_reinspection_commands"))return{rows:[]};if(sql.startsWith("select id from inspection_events"))return{rows:[{id:"event-1"}]};if(sql.includes("lineage_kind='correction'"))return{rows:[{id:"correction-1"}]};throw new Error(`Unexpected query: ${sql}`);},release(){}};
  await assert.rejects(createInspectionReinspection({inspectionId:source.id,companyIds:[source.company_id],expectedVersion:1,actorId:createInput.actorId,reason:"Verify repair",mechanicUserIds:[],startImmediately:false,idempotencyKey:"reinspect-superseded-source"},{pool:{connect:async()=>client}}),(error)=>error.statusCode===409&&error.code==="INSPECTION_REINSPECTION_SOURCE_SUPERSEDED");
  assert.match(inspectionRepositoryInternals.reinspectionBlockerSql,/superseded_by_correction/);
});

test("correction rejects a predecessor that already has a correction successor",async()=>{
  const source={...activeInspectionRow,status:"completed",result:"issues_found",completed_at:"2026-09-03T12:00:00.000Z"};
  const client={async query(sql){if(["begin","commit","rollback"].includes(sql)||sql.startsWith("select pg_advisory"))return{rows:[]};if(sql.includes("from inspections inspection"))return{rows:[source]};if(sql.includes("from inspection_correction_commands"))return{rows:[]};if(sql.startsWith("select id from inspection_events"))return{rows:[{id:"event-1"}]};if(sql.includes("lineage_kind='correction'"))return{rows:[{id:"newer-correction"}]};throw new Error(`Unexpected query: ${sql}`);},release(){}};
  await assert.rejects(createInspectionCorrection({inspectionId:source.id,companyIds:[source.company_id],expectedVersion:1,actorId:createInput.actorId,reason:"Correct evidence",changes:{finalNotes:"Corrected"},idempotencyKey:"correction-linear-chain"},{pool:{connect:async()=>client}}),(error)=>error.statusCode===409&&error.code==="INSPECTION_CORRECTION_SUPERSEDED");
});

test("correction preserves unchanged response actor and changes only corrected response attribution",async()=>{
  const source=await readFile(new URL("inspections.repo.js",import.meta.url),"utf8");
  const correction=source.slice(source.indexOf("export async function createInspectionCorrection"),source.indexOf("export async function createInspectionReinspection"));
  assert.match(correction,/select company_id,\$2,item_key,response,na_reason,updated_by_user_id,created_at,updated_at from inspection_responses/);
  assert.match(correction,/update inspection_responses set response=\$3,na_reason=\$4,updated_by_user_id=\$5/);
});
test("reinspection starts an original print archive while retaining its observation reason", async () => {
  for (const kind of ["reinspection", "correction"]) {
    let inserted;
    const row = {id:"inspection-new", company_id:"company", location_id:"location", asset_id:"asset", inspection_number:"INS-QA", status:"completed", result:"passed", unit_type:"Truck", lineage_kind:kind, predecessor_inspection_id:"inspection-source", revision_reason:"Verify repaired lamp", template_snapshot:{sections:[]}, asset_snapshot:{unitNo:"QA"}};
    const client = {query:async (sql, values) => {
      if(sql.startsWith("select archive.*")) return {rows:[{id:"archive-source",revision_number:2,predecessor_inspection_number:"INS-SOURCE"}]};
      if(sql.startsWith("insert into inspection_print_archives")) { inserted=values; return {rows:[{id:"archive-new",revision_number:values[5],status:"pending"}]}; }
      return {rows:[]};
    }};
    await inspectionRepositoryInternals.archiveCompletedInspection(client,row,[],[],"actor");
    assert.equal(inserted[4],kind==="correction"?"revised":"original");
    assert.equal(inserted[5],kind==="correction"?3:1);
    assert.equal(inserted[6],kind==="correction"?"archive-source":null);
    assert.equal(inserted[7],kind==="correction"?"Verify repaired lamp":"");
    assert.equal(JSON.parse(inserted[8]).revisionReason,"Verify repaired lamp");
    assert.equal(JSON.parse(inserted[8]).lineageKind,kind);
  }
});
