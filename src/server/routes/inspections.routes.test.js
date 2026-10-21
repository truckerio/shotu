import test from "node:test";
import assert from "node:assert/strict";
import { handleInspectionsApi } from "./inspections.routes.js";

test("list route passes validated global filters and sort and rejects invalid sort", async () => {
  const h = harness(); let received;
  await handleInspectionsApi({ method: "GET" }, {}, new URL("http://x/api/inspections?status=completed&unitType=Truck&result=passed&sort=updated_asc"), h.helpers, { list: async (_context, value) => { received = value; return { items: [] }; } });
  assert.equal(received.sort, "updated_asc"); assert.equal(received.unitType, "Truck"); assert.equal(received.result, "passed"); assert.equal(received.status, "completed");
  await assert.rejects(handleInspectionsApi({ method: "GET" }, {}, new URL("http://x/api/inspections?sort=invalid"), h.helpers, { list: async () => assert.fail("Invalid query must not reach service") }), error => error.statusCode === 400);
});

test("queue-options route delegates only its authenticated context without loading detail", async () => {
  const h = harness(); let received;
  const options = { locations: [{ id: "yard", name: "Yard" }], mechanics: [] };
  await handleInspectionsApi({ method: "GET" }, {}, new URL("http://x/api/inspections/queue-options"), h.helpers, { queueOptions: async context => { received = context; return options; } });
  assert.equal(received, h.helpers.requestContext);
  assert.deepEqual(h.sent[0], { status: 200, payload: options });
});

test("list route forwards a bounded page and retains cursor-only response compatibility", async () => {
  const paged = harness(); let parsed;
  const response = { items: [], page: 2, total: 31, pageCount: 2, nextCursor: null };
  await handleInspectionsApi({ method: "GET" }, {}, new URL("http://x/api/inspections?page=2&limit=20&sort=updated_asc"), paged.helpers, {
    list: async (_context, input) => { parsed = input; return response; },
  });
  assert.equal(parsed.page, 2);
  assert.equal(parsed.limit, 20);
  assert.equal(parsed.sort, "updated_asc");
  assert.deepEqual(paged.sent[0], { status: 200, payload: response });

  const cursor = harness(); let cursorInput;
  await handleInspectionsApi({ method: "GET" }, {}, new URL("http://x/api/inspections?cursor=opaque&limit=20"), cursor.helpers, {
    list: async (_context, input) => { cursorInput = input; return { items: [], nextCursor: null }; },
  });
  assert.equal(cursorInput.page, undefined);
  assert.equal(cursorInput.cursor, "opaque");
  assert.deepEqual(cursor.sent[0].payload, { items: [], nextCursor: null });
});

test("list route rejects invalid page, limit, and page-plus-cursor before service access", async () => {
  for (const query of ["page=0", "page=-1", "page=1.5", "page=nope", "page=1&cursor=opaque", "limit=0", "limit=51"]) {
    const h = harness();
    await assert.rejects(handleInspectionsApi({ method: "GET" }, {}, new URL(`http://x/api/inspections?${query}`), h.helpers, {
      list: async () => assert.fail("Invalid listing query reached service"),
    }), (error) => error.statusCode === 400, query);
  }
});

function harness(body={}){const sent=[];return{sent,helpers:{requestContext:{actor:{id:"u"}},readBody:async()=>body,sendJson:(_res,status,payload)=>sent.push({status,payload}),sendPdfBytes:(_res,bytes,fileName)=>sent.push({status:200,bytes,fileName})}};}
test("route validates and delegates idempotent weekly inspection creation",async()=>{const input={companyId:"11111111-1111-4111-8111-111111111111",locationId:"22222222-2222-4222-8222-222222222222",assetId:"33333333-3333-4333-8333-333333333333",mechanicUserIds:[],idempotencyKey:"inspection-create-001"};const h=harness(input);let received;assert.equal(await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections"),h.helpers,{request:async(_context,value)=>(received=value,{id:"i"})}),true);assert.equal(h.sent[0].status,201);assert.equal(received.officeInstructions,"");assert.equal(received.idempotencyKey,"inspection-create-001");});
test("route rejects inspection creation without an idempotency key",async()=>{const h=harness({companyId:"11111111-1111-4111-8111-111111111111",locationId:"22222222-2222-4222-8222-222222222222",assetId:"33333333-3333-4333-8333-333333333333",mechanicUserIds:[]});await assert.rejects(handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections"),h.helpers,{request:async()=>assert.fail()}),/expected string|required/i);});
test("route accepts each inspection type and rejects unknown types before service access", async () => {
  const input={companyId:"11111111-1111-4111-8111-111111111111",locationId:"22222222-2222-4222-8222-222222222222",assetId:"33333333-3333-4333-8333-333333333333",idempotencyKey:"inspection-create-type"};
  for(const inspectionType of ["weekly","annual","pre_trip","post_trip","custom"]){
    const h=harness({...input,inspectionType});let received;
    await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections"),h.helpers,{request:async(_context,value)=>(received=value,{id:"i"})});
    assert.equal(received.inspectionType,inspectionType);assert.equal(h.sent[0].status,201);
  }
  const invalid=harness({...input,inspectionType:"monthly"});
  await assert.rejects(handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections"),invalid.helpers,{request:async()=>assert.fail("Invalid type reached service")}),error=>error.statusCode===400);
});
test("route parses bounded cursor list without loading detail",async()=>{const h=harness();let value;await handleInspectionsApi({method:"GET"},{},new URL("http://x/api/inspections?status=completed&limit=20&search=T12"),h.helpers,{list:async(_context,input)=>(value=input,{items:[],nextCursor:null})});assert.equal(value.limit,20);assert.equal(value.status,"completed");assert.equal(h.sent[0].status,200);});
test("route accepts the bounded not_completed status contract",async()=>{const h=harness();let value;await handleInspectionsApi({method:"GET"},{},new URL("http://x/api/inspections?status=not_completed"),h.helpers,{list:async(_context,input)=>(value=input,{items:[],nextCursor:null})});assert.equal(value.status,"not_completed");assert.equal(h.sent[0].status,200);});
test("workorder inspection context route validates identity and returns all source choices",async()=>{const workorderId="44444444-4444-4444-8444-444444444444";const h=harness();let received;const payload={inspectionContext:{workorderId,sources:[{inspectionId:"new"},{inspectionId:"old"}]}};await handleInspectionsApi({method:"GET"},{},new URL(`http://x/api/inspections/workorders/${workorderId}/context`),h.helpers,{workorderContext:async(_context,id)=>(received=id,payload)});assert.equal(received,workorderId);assert.deepEqual(h.sent[0],{status:200,payload});const invalid=harness();await assert.rejects(handleInspectionsApi({method:"GET"},{},new URL("http://x/api/inspections/workorders/not-a-uuid/context"),invalid.helpers,{workorderContext:async()=>assert.fail()}),/uuid|invalid/i);});
test("response route requires expected version and issue details",async()=>{const h=harness({expectedVersion:2,responses:[{itemKey:"brakes",response:"issue"}]});await assert.rejects(handleInspectionsApi({method:"PATCH"},{},new URL("http://x/api/inspections/i/responses"),h.helpers,{responses:async()=>assert.fail()}),/severity|finding|Issue/i);});
test("response route accepts only Attention deferrals with a review trigger",async()=>{const valid=harness({expectedVersion:2,responses:[{itemKey:"fluid",response:"issue",finding:{severity:"attention",note:"Fluid low",disposition:"defer",deferral:{reason:"Safe until review",nextVisit:true,dueDate:null,dueMiles:null,baselineMiles:null,additionalMiles:null}}}]});let input;await handleInspectionsApi({method:"PATCH"},{},new URL("http://x/api/inspections/i/responses"),valid.helpers,{responses:async(_context,_id,value)=>(input=value,{id:"i"})});assert.equal(input.responses[0].finding.deferral.earlyMiles,200);for(const severity of ["repair_required","out_of_service"]){const invalid=harness({expectedVersion:2,responses:[{itemKey:"fluid",response:"issue",finding:{severity,note:"Unsafe",disposition:"defer",deferral:{reason:"Wait",nextVisit:true,dueDate:null,dueMiles:null,baselineMiles:null,additionalMiles:null}}}]});await assert.rejects(handleInspectionsApi({method:"PATCH"},{},new URL("http://x/api/inspections/i/responses"),invalid.helpers,{responses:async()=>assert.fail()}),/Attention|deferred/i);}});
test("start route requires review evidence, accepts bounded readings, and rejects location re-entry",async()=>{const valid=harness({expectedVersion:2,odometerMiles:123456.7,engineHours:8901.2,previousReportReviewed:true});let received;await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/actions/start"),valid.helpers,{start:async(_context,id,input)=>(received={id,input},{id})});assert.equal(received.input.odometerMiles,123456.7);assert.equal(received.input.previousReportReviewed,true);const missing=harness({expectedVersion:2,odometerMiles:1});await assert.rejects(handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/actions/start"),missing.helpers,{start:async()=>assert.fail()}),/boolean|required|expected/i);const override=harness({expectedVersion:2,odometerMiles:1,previousReportReviewed:false,locationId:"22222222-2222-4222-8222-222222222222"});await assert.rejects(handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/actions/start"),override.helpers,{start:async()=>assert.fail()}),/unrecognized/i);});
test("claim route accepts only the versioned mechanic claim contract",async()=>{const valid=harness({expectedVersion:2});let received;await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/actions/claim"),valid.helpers,{claim:async(_context,id,input)=>(received={id,input},{id,status:"assigned"})});assert.deepEqual(received,{id:"i",input:{expectedVersion:2}});assert.equal(valid.sent[0].status,200);const invalid=harness({expectedVersion:2,mechanicUserIds:["33333333-3333-4333-8333-333333333333"]});await assert.rejects(handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/actions/claim"),invalid.helpers,{claim:async()=>assert.fail()}),/unrecognized/i);});
test("assignment, eligible workorders, link, and archive routes use narrow validated contracts", async () => {
  const h = harness({ expectedVersion:2, mechanicUserIds:["33333333-3333-4333-8333-333333333333"] });
  let assignment;
  await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/assignments"),h.helpers,{assign:async(_context,id,input) => (assignment={id,input},{id})});
  assert.equal(assignment.id,"i"); assert.equal(assignment.input.expectedVersion,2);
  const lookup=harness(); await handleInspectionsApi({method:"GET"},{},new URL("http://x/api/inspections/i/workorders?search=WO&limit=3"),lookup.helpers,{eligibleWorkorders:async(_context,id,input) => ({items:[{id,input}]})});
  assert.deepEqual(lookup.sent[0].payload.items[0].input,{search:"WO",limit:3});
  const link=harness({expectedVersion:3,workorderId:"44444444-4444-4444-8444-444444444444",idempotencyKey:"inspection-link-001"}); let linked;
  await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/findings/f/workorder-links"),link.helpers,{link:async(_context,id,findingId,input) => (linked={id,findingId,input},{id})});
  assert.equal(linked.findingId,"f"); assert.equal(linked.input.workorderId,"44444444-4444-4444-8444-444444444444");
  const archive=harness({idempotencyKey:"inspection-print-001"}); await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/print-archives"),archive.helpers,{createArchive:async()=>({archive:{id:"a"}})});
  assert.equal(archive.sent[0].status,201);
  const pdf=harness();await handleInspectionsApi({method:"GET"},{},new URL("http://x/api/inspections/i/print-archives/a/pdf"),pdf.helpers,{readArchivePdf:async()=>({bytes:Buffer.from("%PDF-test"),fileName:"INS-1.pdf"})});
  assert.equal(pdf.sent[0].fileName,"INS-1.pdf");assert.equal(pdf.sent[0].bytes.subarray(0,5).toString(),"%PDF-");
});

test("typed correction, reinspection, and atomic finding-workorder routes use distinct contracts", async () => {
  const correction=harness({expectedVersion:3,reason:"Correct a recorded finding",changes:{finalNotes:"Corrected"},idempotencyKey:"inspection-correction-001"}); let corrected;
  await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/actions/correct"),correction.helpers,{correct:async(_context,id,input)=>(corrected={id,input},{id:"correction"})});
  assert.equal(corrected.id,"i");assert.equal(corrected.input.changes.finalNotes,"Corrected");assert.equal(correction.sent[0].status,201);
  const reinspection=harness({expectedVersion:3,reason:"Verify completed repair",mechanicUserIds:[],idempotencyKey:"inspection-reinspect-001"});let reinspected;
  await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/actions/reinspect"),reinspection.helpers,{reinspect:async(_context,id,input)=>(reinspected={id,input},{id:"reinspection"})});
  assert.equal(reinspected.input.startImmediately,false);assert.equal(reinspection.sent[0].status,201);
  const invalidSelfStart=harness({expectedVersion:3,reason:"Verify completed repair",mechanicUserIds:[],startImmediately:true,idempotencyKey:"inspection-reinspect-invalid"});await assert.rejects(handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/actions/reinspect"),invalidSelfStart.helpers,{reinspect:async()=>assert.fail()}),/false|literal|invalid/i);
  const create=harness({expectedVersion:3,findingIds:["44444444-4444-4444-8444-444444444444"],idempotencyKey:"inspection-create-001"}); let received;
  await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/workorders"),create.helpers,{createWorkorder:async(_context,id,input)=>(received={id,input},{workorderId:"w"})});
  assert.equal(received.id,"i"); assert.deepEqual(received.input.findingIds,["44444444-4444-4444-8444-444444444444"]); assert.equal(create.sent[0].status,201);
  const legacy=harness({expectedVersion:3,reason:"Ambiguous",idempotencyKey:"inspection-revision-old"});assert.equal(await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/revisions"),legacy.helpers,{}),false);
});

test("completion route carries explicit Admin inspector attestation",async()=>{const h=harness({expectedVersion:4,finalNotes:"Done",actingAsInspector:true});let received;await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/i/actions/complete"),h.helpers,{complete:async(_context,id,input)=>(received={id,input},{id})});assert.equal(received.input.actingAsInspector,true);});

test("completed finding follow-up routes require versioned idempotent contracts",async()=>{const findingId="44444444-4444-4444-8444-444444444444";const link=harness({expectedVersion:1,workorderId:"55555555-5555-4555-8555-555555555555",idempotencyKey:"follow-up-link-001"});let linked;await handleInspectionsApi({method:"POST"},{},new URL(`http://x/api/inspections/i/follow-ups/${findingId}/actions/link-workorder`),link.helpers,{linkFollowUp:async(_context,id,finding,input)=>(linked={id,finding,input},{inspection:{id}})});assert.equal(linked.finding,findingId);assert.equal(linked.input.expectedVersion,1);const create=harness({expectedVersion:1,idempotencyKey:"follow-up-create-001",concern:"Repair tire"});await handleInspectionsApi({method:"POST"},{},new URL(`http://x/api/inspections/i/follow-ups/${findingId}/actions/create-workorder`),create.helpers,{createFollowUpWorkorder:async()=>({inspection:{id:"i"},workorderId:"w"})});assert.equal(create.sent[0].status,201);const noWorkorder=harness({expectedVersion:1,idempotencyKey:"follow-up-none-001",reason:"Observed condition is acceptable"});await handleInspectionsApi({method:"POST"},{},new URL(`http://x/api/inspections/i/follow-ups/${findingId}/actions/no-workorder`),noWorkorder.helpers,{noWorkorderFollowUp:async()=>({inspection:{id:"i"}})});assert.equal(noWorkorder.sent[0].status,200);});

test("maintenance read routes delegate inspection and workorder scope without read-side writes",async()=>{const inspection=harness();let inspectionId;await handleInspectionsApi({method:"GET"},{},new URL("http://x/api/inspections/visit/maintenance"),inspection.helpers,{maintenance:async(_context,id)=>(inspectionId=id,{items:[],mileage:{state:"unknown"},canManage:false,canManageWorkorders:false,canRecordMileage:false})});assert.equal(inspectionId,"visit");assert.equal(inspection.sent[0].payload.items.length,0);const workorderId="44444444-4444-4444-8444-444444444444";const workorder=harness();let received;await handleInspectionsApi({method:"GET"},{},new URL(`http://x/api/inspections/workorders/${workorderId}/maintenance`),workorder.helpers,{workorderMaintenance:async(_context,id)=>(received=id,{items:[]})});assert.equal(received,workorderId);const invalid=harness();await assert.rejects(handleInspectionsApi({method:"GET"},{},new URL("http://x/api/inspections/workorders/not-a-uuid/maintenance"),invalid.helpers,{workorderMaintenance:async()=>assert.fail()}),/uuid|invalid/i);});

test("defer and verify routes validate distinct idempotent maintenance commands",async()=>{const finding="44444444-4444-4444-8444-444444444444";const defer=harness({expectedVersion:1,idempotencyKey:"follow-up-defer-001",reason:"Still safe",deferral:{reason:"Still safe",nextVisit:true,dueDate:null,dueMiles:null,baselineMiles:null,additionalMiles:null,earlyMiles:200}});let deferred;await handleInspectionsApi({method:"POST"},{},new URL(`/api/inspections/original/follow-ups/${finding}/actions/defer`,"http://x"),defer.helpers,{deferFollowUp:async(_context,id,findingId,input)=>(deferred={id,findingId,input},{inspection:{id}})});assert.equal(deferred.input.deferral.earlyMiles,200);const verify=harness({expectedVersion:2,idempotencyKey:"follow-up-verify-001",reason:"Condition corrected"});let verified;await handleInspectionsApi({method:"POST"},{},new URL(`/api/inspections/original/follow-ups/${finding}/actions/verify`,"http://x"),verify.helpers,{verifyFollowUp:async(_context,id,findingId,input)=>(verified={id,findingId,input},{inspection:{id}})});assert.equal(verified.input.reason,"Condition corrected");const invalid=harness({expectedVersion:1,idempotencyKey:"follow-up-defer-bad",reason:"Wait",deferral:{reason:"Wait",nextVisit:false,dueDate:null,dueMiles:null,baselineMiles:null,additionalMiles:null,earlyMiles:200}});await assert.rejects(handleInspectionsApi({method:"POST"},{},new URL(`/api/inspections/original/follow-ups/${finding}/actions/defer`,"http://x"),invalid.helpers,{deferFollowUp:async()=>assert.fail()}),/Choose next shop visit|trigger/i);});

test("defer route rejects conflicting audit text and non-calendar policy input before service",async()=>{const finding="44444444-4444-4444-8444-444444444444";for(const body of [{expectedVersion:1,idempotencyKey:"follow-up-defer-mismatch",reason:"Audit A",deferral:{reason:"Audit B",nextVisit:true,dueDate:null,dueMiles:null,baselineMiles:null,additionalMiles:null,earlyMiles:200}},{expectedVersion:1,idempotencyKey:"follow-up-defer-date",reason:"Wait",deferral:{reason:"Wait",nextVisit:false,dueDate:"2026-02-31",dueMiles:null,baselineMiles:null,additionalMiles:null,earlyMiles:200}},{expectedVersion:1,idempotencyKey:"follow-up-defer-sum",reason:"Wait",deferral:{reason:"Wait",nextVisit:false,dueDate:null,dueMiles:1000,baselineMiles:900,additionalMiles:50,earlyMiles:200}}]){const h=harness(body);await assert.rejects(handleInspectionsApi({method:"POST"},{},new URL(`/api/inspections/original/follow-ups/${finding}/actions/defer`,"http://x"),h.helpers,{deferFollowUp:async()=>assert.fail()}),/reason|date|mileage|target|match|valid/i);}});

test("manual and provider mileage routes return a mileage envelope",async()=>{const manual=harness({expectedVersion:0,idempotencyKey:"manual-mileage-001",miles:249800,observedAt:"2026-10-14T10:00:00.000Z",reason:"Dashboard verified"});let manualInput;await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/visit/mileage"),manual.helpers,{recordMileage:async(_context,id,input)=>(manualInput={id,input},{miles:input.miles,state:"fresh"})});assert.equal(manualInput.id,"visit");assert.equal(manual.sent[0].payload.mileage.miles,249800);const provider=harness({expectedVersion:1,idempotencyKey:"provider-mileage-001",reason:"Samsara reading confirmed"});let providerInput;await handleInspectionsApi({method:"POST"},{},new URL("http://x/api/inspections/visit/mileage/provider"),provider.helpers,{acceptProviderMileage:async(_context,id,input)=>(providerInput={id,input},{miles:250000,state:"fresh"})});assert.equal(providerInput.input.reason,"Samsara reading confirmed");assert.equal(provider.sent[0].payload.mileage.miles,250000);});
