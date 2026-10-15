import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { acceptInspectionProviderMileage, assignInspection, claimInspection, completeInspection, correctInspection, createInspectionFindingWorkorder, createInspectionFollowUpWorkorder, createInspectionPrintArchiveRecord, deferInspectionFollowUp, eligibleInspectionWorkorders, inspectionMaintenanceContext, linkInspectionFollowUpWorkorder, linkInspectionToWorkorder, patchInspectionResponses, printInspectionSlip, queryInspectionSummaries,readInspection,readInspectionPrintArchiveRecord,recordInspectionMileage,reinspectInspection,requestInspection, resolveInspectionFollowUpNoWorkorder,startInspection,unitMaintenanceContext,verifyInspectionFollowUp,workorderInspectionContext } from "./inspection.service.js";
import { inspectionPrintSnapshotDigest } from "./inspection-print-integrity.js";
import { closePool } from "../../db/pool.js";
test.after(closePool);
const companyId="11111111-1111-4111-8111-111111111111",locationId="22222222-2222-4222-8222-222222222222",userId="33333333-3333-4333-8333-333333333333";
const context={actor:{id:userId,role:"office"},companyIds:new Set([companyId]),locationIds:new Set([locationId]),companyRoles:new Map([[companyId,"office"]])};
test("office creation authorizes product write and preserves its idempotency key",async()=>{const calls=[];await requestInspection(context,{companyId,locationId,assetId:userId,mechanicUserIds:[],idempotencyKey:"inspection-create-001"},{authorizeProduct:async(...args)=>calls.push(["auth",...args]),create:async(input)=>(calls.push(["create",input]),input)});assert.equal(calls[0][0],"auth");assert.equal(calls[0][3],"write");assert.equal(calls[1][1].idempotencyKey,"inspection-create-001");});
test("mechanic creation assigns self without bypassing start evidence",async()=>{const mechanicContext={actor:{id:userId,role:"mechanic"},companyIds:new Set([companyId]),locationIds:new Set([locationId]),companyRoles:new Map([[companyId,"mechanic"]])};const created=await requestInspection(mechanicContext,{companyId,locationId,assetId:userId,mechanicUserIds:[],idempotencyKey:"inspection-create-mechanic"},{authorizeProduct:async()=>{},create:async(input)=>input});assert.deepEqual(created.mechanicUserIds,[userId]);assert.equal(created.startImmediately,false);});
test("mechanic can read and atomically claim an available requested inspection",async()=>{const mechanicContext={actor:{id:userId,role:"mechanic"},companyIds:new Set([companyId]),locationIds:new Set([locationId]),companyRoles:new Map([[companyId,"mechanic"]])};const record={id:"i",companyId,locationId,status:"requested",version:3,assignments:[],responses:[],findings:[],workorderLinks:[]};const visible=await readInspection(mechanicContext,"i",{load:async()=>record,authorizeProduct:async()=>({mode:"full"}),authorizeWorkorders:async()=>({mode:"full"})});assert.equal(visible.id,"i");let assignedInput;const claimed=await claimInspection(mechanicContext,"i",{expectedVersion:3},{load:async()=>record,authorizeProduct:async()=>({mode:"full"}),assign:async(input)=>(assignedInput=input,{...record,status:"assigned",version:4})});assert.equal(claimed.status,"assigned");assert.deepEqual(assignedInput.mechanicUserIds,[userId]);assert.equal(assignedInput.expectedVersion,3);assert.deepEqual(assignedInput.companyIds,[companyId]);});
test("inspection claim is mechanic-only and cannot take another mechanic's assignment",async()=>{const mechanicContext={actor:{id:userId,role:"mechanic"},companyIds:new Set([companyId]),locationIds:new Set([locationId]),companyRoles:new Map([[companyId,"mechanic"]])};const requested={id:"i",companyId,locationId,status:"requested",version:3,assignments:[]};await assert.rejects(claimInspection(context,"i",{expectedVersion:3},{load:async()=>requested,authorizeProduct:async()=>({mode:"full"}),assign:async()=>assert.fail()}),(error)=>error.statusCode===403);const assignedElsewhere={...requested,status:"assigned",assignments:[{mechanicUserId:"other",role:"primary"}]};await assert.rejects(readInspection(mechanicContext,"i",{load:async()=>assignedElsewhere,authorizeProduct:async()=>assert.fail()}),/not found/i);});
test("start forwards bounded readings and review evidence without accepting a location override",async()=>{const mechanicContext={actor:{id:userId,role:"mechanic"},companyIds:new Set([companyId]),locationIds:new Set([locationId]),companyRoles:new Map([[companyId,"mechanic"]])};const record={id:"i",companyId,locationId,assetId:"asset",unitType:"Truck",status:"assigned",version:2,assignments:[{mechanicUserId:userId,role:"primary"}]};const started=await startInspection(mechanicContext,"i",{expectedVersion:2,odometerMiles:120003.4,engineHours:8321.2,previousReportReviewed:true},{load:async()=>record,authorizeProduct:async()=>{},transition:async(input)=>input});assert.equal(started.locationId,undefined);assert.equal(started.odometerMiles,120003.4);assert.equal(started.engineHours,8321.2);assert.equal(started.previousReportReviewed,true);});
test("workorder inspection context verifies canonical workorder access before both product reads",async()=>{const calls=[];const candidate={id:"workorder",companyId,locationId};const sources=[{inspectionId:"i",eligible:true,blockerCode:null,blockerMessage:null}];const value=await workorderInspectionContext(context,"workorder",{loadWorkorder:async()=>(calls.push(["load"]),candidate),requireWorkorder:async(effective,id,options)=>(calls.push(["resource",id,options,effective.actor.role]),options.getWorkorder()),authorizeWorkorders:async(_context,scope,mode)=>calls.push(["product",scope.moduleKey,mode,scope.companyId,scope.locationId]),authorizeInspections:async(_context,scope,mode)=>calls.push(["product",scope.moduleKey,mode,scope.companyId,scope.locationId]),listSources:async(input)=>(calls.push(["list",input]),sources)});assert.deepEqual(value,{inspectionContext:{workorderId:"workorder",sources}});assert.equal(calls[0][0],"load");assert.equal(calls[1][0],"resource");assert.equal(calls[1][2].requireLocationMembership,true);assert.equal(await calls[1][2].getWorkorder(),candidate);assert.equal(calls[1][3],"office");assert.deepEqual(calls.slice(2,4).map((entry)=>entry.slice(0,3)),[["product","workorders","read"],["product","inspections","read"]]);assert.deepEqual(calls[4],["list",{companyId,locationId,workorderId:"workorder",restrictToActor:false,actorId:userId}]);});
test("workorder inspection context fails closed before source lookup for resource or product denial",async()=>{let listed=false;const candidate={id:"workorder",companyId,locationId};const hidden=Object.assign(new Error("Workorder not found."),{statusCode:404});await assert.rejects(workorderInspectionContext(context,"hidden",{loadWorkorder:async()=>candidate,requireWorkorder:async()=>{throw hidden;},authorizeWorkorders:async()=>assert.fail(),authorizeInspections:async()=>assert.fail(),listSources:async()=>{listed=true;}}),(error)=>error===hidden);assert.equal(listed,false);const denied=Object.assign(new Error("Forbidden"),{statusCode:403});await assert.rejects(workorderInspectionContext(context,"workorder",{loadWorkorder:async()=>candidate,requireWorkorder:async(_context,_id,options)=>options.getWorkorder(),authorizeWorkorders:async()=>{},authorizeInspections:async()=>{throw denied;},listSources:async()=>{listed=true;}}),(error)=>error===denied);assert.equal(listed,false);});
test("workorder inspection context rejects missing effective tenant role or location without querying sources",async()=>{let listed=false;for(const workorder of [{id:"w",companyId:"other",locationId},{id:"w",companyId,locationId:null}])await assert.rejects(workorderInspectionContext(context,"w",{loadWorkorder:async()=>workorder,requireWorkorder:async()=>assert.fail(),authorizeWorkorders:async()=>assert.fail(),authorizeInspections:async()=>assert.fail(),listSources:async()=>{listed=true;}}),/not found/i);assert.equal(listed,false);});
test("workorder inspection context uses the target-company role for canonical RBAC",async()=>{const mixed={...context,actor:{id:userId,role:"office"},companyRoles:new Map([[companyId,"mechanic"]])};let effectiveRole;await workorderInspectionContext(mixed,"w",{loadWorkorder:async()=>({id:"w",companyId,locationId}),requireWorkorder:async(effective,_id,options)=>(effectiveRole=effective.actor.role,options.getWorkorder()),authorizeWorkorders:async()=>{},authorizeInspections:async()=>{},listSources:async()=>[]});assert.equal(effectiveRole,"mechanic");});

test("workorder inspection context restricts mechanics to source inspections assigned to them",async()=>{const mixed={...context,companyRoles:new Map([[companyId,"mechanic"]])};let input;await workorderInspectionContext(mixed,"w",{loadWorkorder:async()=>({id:"w",companyId,locationId}),requireWorkorder:async(_effective,_id,options)=>options.getWorkorder(),authorizeWorkorders:async()=>{},authorizeInspections:async()=>{},listSources:async(value)=>(input=value,[])});assert.equal(input.restrictToActor,true);assert.equal(input.actorId,userId);});
test("read-only unfinished projection excludes checklist and private notes",async()=>{const inspection={id:"i",companyId,locationId,status:"in_progress",version:2,assignments:[],responses:[{itemKey:"x",response:"issue"}],findings:[{note:"private"}],officeInstructions:"private"};const value=await readInspection(context,"i",{load:async()=>inspection,authorizeProduct:async()=>({mode:"read"})});assert.equal(value.responses,undefined);assert.equal(value.findings,undefined);assert.equal(value.officeInstructions,undefined);});
test("inspection-only completed projection hides linked workorder identity",async()=>{const inspection={id:"i",companyId,locationId,status:"completed",version:2,assignments:[],responses:[],findings:[],workorderLinks:[{workorderId:"secret",workorderSerial:"WO-1"}]};const value=await readInspection(context,"i",{load:async()=>inspection,authorizeProduct:async()=>({mode:"read"}),authorizeWorkorders:async()=>{const error=new Error("denied");error.statusCode=403;throw error;}});assert.equal(value.workorderLinks,undefined);assert.equal(value.workordersLinked,true);});
test("surveillance never receives workorder identity it has no role route to open",async()=>{const surveillance={actor:{id:userId,role:"surveillance"},companyIds:new Set([companyId]),locationIds:new Set([locationId]),companyRoles:new Map([[companyId,"surveillance"]])};const inspection={id:"i",companyId,locationId,status:"completed",version:2,assignments:[],responses:[],findings:[],workorderLinks:[{workorderId:"secret",workorderSerial:"WO-1"}]};let workordersChecked=false;const value=await readInspection(surveillance,"i",{load:async()=>inspection,authorizeProduct:async()=>({mode:"read"}),authorizeWorkorders:async()=>{workordersChecked=true;return{mode:"full"};}});assert.equal(workordersChecked,false);assert.equal(value.workorderLinks,undefined);assert.equal(value.workordersLinked,true);});
test("inspection-only completed projection exposes minimal follow-up state without workorder identity",async()=>{const inspection={id:"i",companyId,locationId,status:"completed",version:2,assignments:[],responses:[],findings:[],workorderLinks:[],followUps:[{id:"fu",findingId:"f",status:"resolved_workorder",version:2,workorderId:"secret",reason:"secret"}]};const value=await readInspection(context,"i",{load:async()=>inspection,authorizeProduct:async()=>({mode:"read"}),authorizeWorkorders:async()=>{const error=new Error("denied");error.statusCode=403;throw error;}});assert.deepEqual(value.followUps,[{id:"fu",findingId:"f",status:"resolved_workorder",version:2}]);});
test("creating an immutable print archive requires write access and normalizes start evidence",async()=>{const inspection={id:"i",companyId,locationId,status:"completed",version:2,inspectionNumber:"INS-1",completedAt:new Date("2026-09-02T12:00:00.000Z"),asset:{unitNo:"1"},templateSnapshot:{sections:[]},responses:[],findings:[],assignments:[],startEvidence:{odometerMiles:120003.4,engineHours:null,previousReportReviewed:true},previousReportAvailable:true};let capability;let persisted;await createInspectionPrintArchiveRecord(context,"i",{idempotencyKey:"inspection-print-test"},{load:async()=>inspection,authorizeProduct:async(_context,_scope,next)=>(capability=next,{mode:"full"}),createArchive:async(input)=>(persisted=input,{archive:{id:"a",snapshot:input.snapshot}})});assert.equal(capability,"write");assert.equal(persisted.snapshot.completedAt,"2026-09-02T12:00:00.000Z");assert.deepEqual(persisted.snapshot.startEvidence,inspection.startEvidence);assert.equal(persisted.snapshot.previousReportAvailable,true);assert.equal(persisted.snapshotSha256,inspectionPrintSnapshotDigest(JSON.parse(JSON.stringify(persisted.snapshot))));});
test("cross-location record returns not found before product authorization",async()=>{const inspection={id:"i",companyId,locationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",status:"completed",assignments:[]};await assert.rejects(readInspection(context,"i",{load:async()=>inspection,authorizeProduct:async()=>assert.fail()}),/not found/i);});
test("mixed-company mechanic scope is enforced in one bounded list query",async()=>{const mechanicCompany="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",officeCompany="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",mechanicLocation="cccccccc-cccc-4ccc-8ccc-cccccccccccc",officeLocation="dddddddd-dddd-4ddd-8ddd-dddddddddddd";const mixed={actor:{id:userId,role:"office"},companyIds:new Set([mechanicCompany,officeCompany]),locationIds:new Set([mechanicLocation,officeLocation]),companyRoles:new Map([[mechanicCompany,"mechanic"],[officeCompany,"office"]])};let listInput;let bootstrapCalls=0;await queryInspectionSummaries(mixed,{limit:25,search:""},{bootstrap:async()=>{bootstrapCalls+=1;return{companies:[{companyId:mechanicCompany,locations:[{locationId:mechanicLocation,modules:{inspections:"full"}}]},{companyId:officeCompany,locations:[{locationId:officeLocation,modules:{inspections:"read"}}]}]};},list:async(input)=>(listInput=input,{items:[]})});assert.equal(bootstrapCalls,1);assert.deepEqual(listInput.restrictedMechanicCompanyIds,[mechanicCompany]);assert.equal(listInput.actorId,userId);assert.deepEqual(listInput.locationIds,[mechanicLocation,officeLocation]);});
test("needs action expands before the bounded queue query", async () => {
  let input; await queryInspectionSummaries(context,{limit:25,search:"",status:"needs_action"},{bootstrap:async()=>({companies:[{companyId,locations:[{locationId,modules:{inspections:"read"}}]}]}),list:async(value)=>(input=value,{items:[]})});
  assert.equal(input.statuses,null);
  assert.equal(input.needsAction,true);
});
test("assignment and workorder link require both product boundaries and carry tenant-scoped inputs", async () => {
  const record={id:"i",companyId,locationId,assetId:"asset",status:"in_progress",version:2,assignments:[]}; const calls=[];
  await assignInspection(context,"i",{expectedVersion:2,mechanicUserIds:[userId]},{load:async()=>record,authorizeProduct:async(...args)=>calls.push(args),assign:async(input)=>input});
  assert.equal(calls.at(-1)[2],"write");
  let accessOptions; const link=await linkInspectionToWorkorder(context,"i","finding",{expectedVersion:2,workorderId:"44444444-4444-4444-8444-444444444444",idempotencyKey:"inspection-link-001"},{load:async()=>record,authorizeProduct:async()=>{},authorizeWorkorders:async()=>{},requireWorkorder:async(_context,_id,options)=>(accessOptions=options,{companyId,locationId,assetId:"asset",status:"open"}),link:async(input)=>input});
  assert.equal(link.findingId,"finding"); assert.deepEqual(link.companyIds,[companyId]); assert.equal(link.locationId,locationId);
  assert.deepEqual(accessOptions,{requireLocationMembership:true,allowAvailable:true,allowActiveAtLocation:true});
  const eligible=await eligibleInspectionWorkorders(context,"i",{search:"WO",limit:5},{load:async()=>record,authorizeProduct:async()=>{},authorizeWorkorders:async()=>{},listEligible:async(input)=>[input]});
  assert.equal(eligible.items[0].assetId,"asset");
});

test("workorder links hide an out-of-location or terminal target before persistence", async () => {
  const record={id:"i",companyId,locationId,assetId:"asset",status:"in_progress",version:2,assignments:[]};
  const invalidTargets = [
    { companyId:"other",locationId,assetId:"asset",status:"open" },
    { companyId,locationId:"other",assetId:"asset",status:"open" },
    { companyId,locationId,assetId:"other",status:"open" },
    { companyId,locationId,assetId:"asset",status:"closed" },
  ];
  for (const [index,target] of invalidTargets.entries()) await assert.rejects(linkInspectionToWorkorder(context,"i","finding",{expectedVersion:2,workorderId:"44444444-4444-4444-8444-444444444444",idempotencyKey:`inspection-link-negative-${index}`},{load:async()=>record,authorizeProduct:async()=>{},authorizeWorkorders:async()=>{},requireWorkorder:async()=>target,link:async()=>assert.fail("must not persist")}),/not found/i);
});

test("assigned mechanic can discover and link a same-unit active workorder without broad workorder access", async () => {
  const mechanicContext={actor:{id:userId,role:"mechanic"},companyIds:new Set([companyId]),locationIds:new Set([locationId]),companyRoles:new Map([[companyId,"mechanic"]])};
  const record={id:"i",companyId,locationId,assetId:"asset",status:"in_progress",version:2,assignments:[{mechanicUserId:userId}]};
  let listInput;
  const eligible=await eligibleInspectionWorkorders(mechanicContext,"i",{search:"WO",limit:5},{load:async()=>record,authorizeProduct:async()=>{},authorizeWorkorders:async()=>{},listEligible:async(input)=>(listInput=input,[{id:"w",status:"in_progress"}])});
  assert.equal(listInput.actorId,null); assert.equal(listInput.companyId,companyId); assert.equal(listInput.locationId,locationId); assert.equal(listInput.assetId,"asset");
  let accessOptions;
  const linked=await linkInspectionToWorkorder(mechanicContext,"i","finding",{expectedVersion:2,workorderId:"44444444-4444-4444-8444-444444444444",idempotencyKey:"inspection-link-active"},{load:async()=>record,authorizeProduct:async()=>{},authorizeWorkorders:async()=>{},requireWorkorder:async(_context,_id,options)=>(accessOptions=options,{companyId,locationId,assetId:"asset",status:"in_progress"}),link:async(input)=>input});
  assert.equal(linked.actorId,userId); assert.equal(accessOptions.allowActiveAtLocation,true);
});

test("completed printing reads the persisted archive rather than rebuilding a live slip", async () => {
  const record={id:"i",companyId,locationId,status:"completed",version:2,assignments:[]};
  const snapshot={html:"<html>archived</html>"}; const snapshotSha256=createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  const result=await printInspectionSlip(context,"i",{load:async()=>record,authorizeProduct:async()=>({mode:"read"}),findLatestArchive:async()=>({id:"archive-1",snapshot,snapshotSha256})});
  assert.equal(result.html,"<html>archived</html>");
  assert.equal(result.archive.downloadUrl,"/api/inspections/i/print-archives/archive-1/pdf");
});

test("PDF creation uses claimed immutable snapshot HTML instead of changed live record data",async()=>{
  const record={id:"i",companyId,locationId,status:"completed",version:5,assignments:[],inspectionNumber:"INS-5",templateSnapshot:{sections:[]},responses:[],findings:[],finalNotes:"Changed live notes",workorderLinks:[{workorderId:"w"}]};
  const snapshot={html:"<html>Frozen revision 3 without later workorder</html>"};const archive={id:"archive-5",companyId,inspectionNumber:"INS-5",status:"pending",leaseToken:"lease",snapshot,snapshotSha256:inspectionPrintSnapshotDigest(snapshot)};let rendered;
  await createInspectionPrintArchiveRecord(context,"i",{idempotencyKey:"inspection-print-frozen"},{load:async()=>record,authorizeProduct:async()=>{},createArchive:async()=>({archive,replayed:true}),outputDir:"/tmp/inspection-pdf-service",writePdf:async(html)=>(rendered=html,"/tmp/inspection-pdf-service/slip.pdf"),readFile:async()=>Buffer.from("%PDF-1.7\narchived"),completeArchive:async()=>({...archive,status:"ready"}),failArchive:async()=>assert.fail(),removeFile:async()=>{}});
  assert.equal(rendered,snapshot.html);
});

test("support mechanic inspection projection suppresses primary-only reinspection",async()=>{
  const mechanicContext={...context,companyRoles:new Map([[companyId,"mechanic"]])};
  const record={id:"i",companyId,locationId,status:"completed",version:2,reinspectionEligible:true,assignments:[{mechanicUserId:userId,role:"support"}],responses:[],findings:[]};
  const result=await readInspection(mechanicContext,"i",{load:async()=>record,authorizeProduct:async()=>({mode:"full"}),authorizeWorkorders:async()=>{}});
  assert.equal(result.reinspectionEligible,false);assert.equal(result.reinspectionBlockerCode,"primary_required");
});

test("completed printing accepts the exact legacy completedAt digest and records audit evidence", async () => {
  const record={id:"i",companyId,locationId,status:"completed",version:2,assignments:[]};
  const snapshot={completedAt:"2026-09-02T12:00:00.000Z",html:"<html>legacy</html>"};
  const snapshotSha256=inspectionPrintSnapshotDigest({...snapshot,completedAt:{}}); let audit;
  const result=await printInspectionSlip(context,"i",{
    load:async()=>record,
    authorizeProduct:async()=>({mode:"read"}),
    findLatestArchive:async()=>({id:"archive-1",companyId,inspectionId:"i",snapshot,snapshotSha256}),
    recordLegacyAcceptance:async(input)=>(audit=input),
  });
  assert.equal(result.html,"<html>legacy</html>");
  assert.equal(audit.archiveId,"archive-1");
  assert.equal(audit.storedSnapshotSha256,snapshotSha256);
  assert.equal(audit.legacyFormat,"completed_at_date_empty_object_v1");
  assert.equal(audit.actorId,userId);
});

test("archive read rejects arbitrary digest mismatches without recording legacy acceptance", async () => {
  const record={id:"i",companyId,locationId,status:"completed",version:2,assignments:[]}; let audited=false;
  await assert.rejects(readInspectionPrintArchiveRecord(context,"i","archive-1",{
    load:async()=>record,
    authorizeProduct:async()=>({mode:"read"}),
    findArchive:async()=>({id:"archive-1",companyId,inspectionId:"i",status:"ready",snapshot:{completedAt:"2026-09-02T12:00:00.000Z",html:"<html>x</html>"},snapshotSha256:"0".repeat(64)}),
    recordLegacyAcceptance:async()=>{audited=true;},
  }), (error)=>error.statusCode===409&&error.code==="INSPECTION_PRINT_ARCHIVE_INTEGRITY_FAILURE");
  assert.equal(audited,false);
});

test("typed lineage commands require Office product write while finding-workorder creation requires both capabilities", async () => {
  const record={id:"i",companyId,locationId,assetId:"asset",status:"completed",version:2,assignments:[]}; const calls=[];
  const corrected=await correctInspection(context,"i",{expectedVersion:2,reason:"Correct note",changes:{finalNotes:"Corrected"},idempotencyKey:"inspection-correction-001"},{load:async()=>record,authorizeProduct:async(...args)=>calls.push(args),correct:async(input)=>input});assert.equal(corrected.inspectionId,"i");
  const reinspected=await reinspectInspection(context,"i",{expectedVersion:2,reason:"Verify repair",mechanicUserIds:[],startImmediately:false,idempotencyKey:"inspection-reinspect-001"},{load:async()=>record,authorizeProduct:async(...args)=>calls.push(args),reinspect:async(input)=>input});assert.equal(reinspected.inspectionId,"i");
  assert.equal(calls[0][2],"write");
  const progress={...record,status:"in_progress"}; const created=await createInspectionFindingWorkorder(context,"i",{expectedVersion:2,findingIds:["f"],idempotencyKey:"inspection-create-001"},{load:async()=>progress,authorizeProduct:async()=>{},authorizeWorkorders:async()=>{},createWorkorder:async(input)=>input});
  assert.deepEqual(created.findingIds,["f"]);
  const mechanicContext={actor:{id:userId,role:"mechanic"},companyIds:new Set([companyId]),locationIds:new Set([locationId]),companyRoles:new Map([[companyId,"mechanic"]])};const source={...record,assignments:[{mechanicUserId:userId,role:"primary"}]};const selfAssigned=await reinspectInspection(mechanicContext,"i",{expectedVersion:2,reason:"Verify repair",mechanicUserIds:[userId],startImmediately:false,idempotencyKey:"inspection-reinspect-self"},{load:async()=>source,authorizeProduct:async()=>{},reinspect:async(input)=>input});assert.equal(selfAssigned.actorId,userId);assert.deepEqual(selfAssigned.mechanicUserIds,[userId]);assert.equal(selfAssigned.startImmediately,false);
  await assert.rejects(correctInspection(mechanicContext,"i",{expectedVersion:2,reason:"Correct",changes:{finalNotes:"No"},idempotencyKey:"inspection-correct-denied"},{load:async()=>source,authorizeProduct:async()=>{},correct:async()=>assert.fail()}),/permission|allowed/i);
});

test("mechanic reinspection assignment denies support, scope/module failures, and payload escalation",async()=>{const mechanicContext={actor:{id:userId,role:"mechanic"},companyIds:new Set([companyId]),locationIds:new Set([locationId]),companyRoles:new Map([[companyId,"mechanic"]])};const base={id:"i",companyId,locationId,assetId:"asset",status:"completed",version:2,assignments:[{mechanicUserId:userId,role:"primary"}]};const command={expectedVersion:2,reason:"Verify repair",mechanicUserIds:[userId],startImmediately:false,idempotencyKey:"inspection-reinspect-self"};
  await assert.rejects(reinspectInspection(mechanicContext,"i",command,{load:async()=>({...base,assignments:[{mechanicUserId:userId,role:"support"}]}),authorizeProduct:async()=>{},reinspect:async()=>assert.fail()}),/permission|allowed/i);
  for(const [index,patch] of [{startImmediately:true},{mechanicUserIds:[]},{mechanicUserIds:[userId,"44444444-4444-4444-8444-444444444444"]},{mechanicUserIds:["44444444-4444-4444-8444-444444444444"]}].entries())await assert.rejects(reinspectInspection(mechanicContext,"i",{...command,...patch,idempotencyKey:`inspection-reinspect-escalation-${index}`},{load:async()=>base,authorizeProduct:async()=>{},reinspect:async()=>assert.fail()}),/permission|allowed/i);
  await assert.rejects(reinspectInspection(mechanicContext,"i",command,{load:async()=>({...base,locationId:"55555555-5555-4555-8555-555555555555"}),authorizeProduct:async()=>assert.fail(),reinspect:async()=>assert.fail()}),/not found/i);
  const off=Object.assign(new Error("Inspections unavailable"),{statusCode:403});await assert.rejects(reinspectInspection(mechanicContext,"i",command,{load:async()=>base,authorizeProduct:async()=>{throw off;},reinspect:async()=>assert.fail()}),(error)=>error===off);
});

test("support mechanics may save responses but only the active primary may complete",async()=>{const mechanicContext={actor:{id:userId,role:"mechanic"},companyIds:new Set([companyId]),locationIds:new Set([locationId]),companyRoles:new Map([[companyId,"mechanic"]])};const support={id:"i",companyId,locationId,status:"in_progress",version:2,assignments:[{mechanicUserId:userId,role:"support"}]};let saved=false;await patchInspectionResponses(mechanicContext,"i",{expectedVersion:2,responses:[{itemKey:"x",response:"pass"}]},{load:async()=>support,authorizeProduct:async()=>{},saveResponses:async()=>{saved=true;return support;}});assert.equal(saved,true);await assert.rejects(completeInspection(mechanicContext,"i",{expectedVersion:2,finalNotes:""},{load:async()=>support,authorizeProduct:async()=>{},transition:async()=>assert.fail("support must not complete")}),/permission|primary|allowed/i);});

test("Admin completion requires explicit acting-as-inspector evidence and records it",async()=>{const adminContext={actor:{id:userId,role:"admin"},companyIds:new Set([companyId]),locationIds:new Set(),companyRoles:new Map([[companyId,"admin"]])};const record={id:"i",companyId,locationId,status:"in_progress",version:2,assignments:[]};await assert.rejects(completeInspection(adminContext,"i",{expectedVersion:2,finalNotes:""},{load:async()=>record,authorizeProduct:async()=>{},transition:async()=>assert.fail()}),/inspector|permission|allowed/i);let transitionInput;await completeInspection(adminContext,"i",{expectedVersion:2,finalNotes:"",actingAsInspector:true},{load:async()=>record,authorizeProduct:async()=>{},transition:async(input)=>(transitionInput=input,record)});assert.equal(transitionInput.completionAuthority,"admin_inspector");assert.equal(transitionInput.details.actingAsInspector,true);});

test("in-progress reassignment cannot remove the active primary",async()=>{const record={id:"i",companyId,locationId,status:"in_progress",version:2,assignments:[{mechanicUserId:userId,role:"primary"}]};await assert.rejects(assignInspection(context,"i",{expectedVersion:2,mechanicUserIds:[]},{load:async()=>record,authorizeProduct:async()=>{},assign:async()=>assert.fail()}),(error)=>error.statusCode===409&&error.code==="INSPECTION_PRIMARY_REQUIRED");});

test("Office follow-up link and create require Workorders write and fail closed for an ineligible target",async()=>{
  const record={id:"i",companyId,locationId,assetId:"asset",status:"completed",assignments:[]};const authorizations=[];
  const dependencies={load:async()=>record,authorizeProduct:async(_context,scope,mode)=>authorizations.push([scope.moduleKey,mode]),authorizeWorkorders:async(_context,scope,mode)=>authorizations.push([scope.moduleKey,mode]),requireWorkorder:async()=>({companyId,locationId,assetId:"asset",status:"open"}),resolveFollowUp:async(input)=>input};
  const linked=await linkInspectionFollowUpWorkorder(context,"i","finding",{expectedVersion:1,workorderId:"workorder",idempotencyKey:"follow-up-link-001"},dependencies);
  assert.equal(linked.action,"link_workorder");assert.deepEqual(authorizations,[['inspections','write'],['workorders','write']]);
  const created=await createInspectionFollowUpWorkorder(context,"i","finding",{expectedVersion:1,idempotencyKey:"follow-up-create-001"},dependencies);assert.equal(created.action,"create_workorder");
  for(const target of [{companyId:"other",locationId,assetId:"asset",status:"open"},{companyId,locationId:"other",assetId:"asset",status:"open"},{companyId,locationId,assetId:"other",status:"open"},{companyId,locationId,assetId:"asset",status:"closed"}])await assert.rejects(linkInspectionFollowUpWorkorder(context,"i","finding",{expectedVersion:1,workorderId:"workorder",idempotencyKey:"follow-up-link-negative"},{...dependencies,requireWorkorder:async()=>target,resolveFollowUp:async()=>assert.fail()}),/not found/i);
});

test("Office no-workorder resolution does not require Workorders permission and mechanics cannot resolve",async()=>{
  const record={id:"i",companyId,locationId,assetId:"asset",status:"completed",assignments:[]};let workordersAuthorization=false;
  const resolved=await resolveInspectionFollowUpNoWorkorder(context,"i","finding",{expectedVersion:1,idempotencyKey:"follow-up-none-001",reason:"No repair is required"},{load:async()=>record,authorizeProduct:async()=>{},authorizeWorkorders:async()=>{workordersAuthorization=true;throw new Error("must not authorize");},resolveFollowUp:async(input)=>input});
  assert.equal(resolved.action,"no_workorder");assert.equal(workordersAuthorization,false);
  const mechanicContext={actor:{id:userId,role:"mechanic"},companyIds:new Set([companyId]),locationIds:new Set([locationId]),companyRoles:new Map([[companyId,"mechanic"]])};
  await assert.rejects(resolveInspectionFollowUpNoWorkorder(mechanicContext,"i","finding",{expectedVersion:1,idempotencyKey:"follow-up-none-002",reason:"No repair is required"},{load:async()=>({...record,assignments:[{mechanicUserId:userId,role:"primary"}]}),authorizeProduct:async()=>{},resolveFollowUp:async()=>assert.fail()}),/permission|allowed/i);
});

test("direct reinspection rejects a Passed source with a stable blocker code",async()=>{
  const passed={id:"i",companyId,locationId,assetId:"asset",status:"completed",result:"passed",version:2,assignments:[]};
  await assert.rejects(reinspectInspection(context,"i",{expectedVersion:2,reason:"Verify condition",mechanicUserIds:[],startImmediately:false,idempotencyKey:"reinspect-passed-source"},{load:async()=>passed,authorizeProduct:async()=>{},reinspect:async()=>assert.fail("must not persist")}),(error)=>error.statusCode===409&&error.code==="INSPECTION_REINSPECTION_SOURCE_PASSED");
});

test("not_completed list status expands only to active lifecycle statuses",async()=>{
  let listInput;
  await queryInspectionSummaries(context,{limit:25,search:"",status:"not_completed"},{bootstrap:async()=>({companies:[{companyId,locations:[{locationId,modules:{inspections:"read"}}]}]}),list:async(input)=>(listInput=input,{items:[]})});
  assert.deepEqual(listInput.statuses,["requested","assigned","in_progress"]);
});

test("inspection maintenance evaluates actual start mileage and strips workorder identity without workorders read",async()=>{
  const record={id:"visit",companyId,locationId,assetId:"asset",unitType:"Truck",status:"in_progress",startedAt:"2026-10-14T10:00:00.000Z",startEvidence:{odometerMiles:249850},assignments:[]};
  const denied=Object.assign(new Error("Denied"),{statusCode:403});
  const value=await inspectionMaintenanceContext(context,"visit",{load:async()=>record,authorizeProduct:async()=>({mode:"full"}),authorizeWorkorders:async()=>{throw denied;},bootstrap:async()=>({companies:[{companyId,locations:[{locationId,modules:{inspections:"read"}}]}]}),readMileage:async()=>({miles:249600,observedAt:"2026-10-14T09:00:00.000Z",source:"samsara_obd",version:1,state:"fresh"}),listMaintenance:async(input)=>{assert.deepEqual(input.locationIds,[locationId]);return[{id:"obligation",findingId:"finding",inspectionId:"source",inspectionNumber:"INS-1",note:"Fluid low",version:1,status:"resolved_workorder",deferral:{reason:"Wait",nextVisit:false,dueDate:null,dueMiles:250000,baselineMiles:null,additionalMiles:null,earlyMiles:200,reviewedAt:"2026-10-10T10:00:00.000Z"},sourceCompletedAt:"2026-10-10T10:00:00.000Z",workorderId:"secret",workorderStatus:"in_progress"}];},now:()=>new Date("2026-10-14T11:00:00.000Z")});
  assert.equal(value.mileage.source,"inspection_start");assert.equal(value.items[0].dueState,"repair_planned");assert.equal(value.items[0].workorderId,undefined);assert.equal(value.items[0].workorderStatus,undefined);assert.equal(value.canManage,true);assert.equal(value.canManageWorkorders,false);assert.equal(value.canRecordMileage,true);
});

test("unit maintenance is Office/Admin only and reads all authorized source locations",async()=>{
  const otherLocation="44444444-4444-4444-8444-444444444444";const adminContext={...context,actor:{id:userId,role:"admin"},locationIds:new Set(),companyRoles:new Map([[companyId,"admin"]])};let listed;
  const value=await unitMaintenanceContext(adminContext,"asset",{loadAsset:async()=>({id:"asset",companyId,locationId:null,unitType:"Truck"}),bootstrap:async()=>({companies:[{companyId,locations:[{locationId,modules:{inspections:"read"}},{locationId:otherLocation,modules:{inspections:"full"}}]}]}),authorizeProduct:async()=>({mode:"full"}),authorizeWorkorders:async()=>({mode:"read"}),readMileage:async()=>({miles:1,observedAt:"2026-10-14T10:00:00Z",source:"manual",version:1,state:"fresh"}),listMaintenance:async(input)=>(listed=input,[])});
  assert.deepEqual(listed.locationIds,[locationId,otherLocation]);assert.equal(value.canRecordMileage,false);
  const mechanic={...context,actor:{id:userId,role:"mechanic"},companyRoles:new Map([[companyId,"mechanic"]])};await assert.rejects(unitMaintenanceContext(mechanic,"asset",{loadAsset:async()=>({id:"asset",companyId,locationId,unitType:"Truck"})}),/not found/i);
});

test("multi-location maintenance applies workorder and action permissions at each obligation source",async()=>{
  const sourceB="44444444-4444-4444-8444-444444444444";const denied=()=>Object.assign(new Error("Denied"),{statusCode:403});
  const value=await unitMaintenanceContext(context,"asset",{loadAsset:async()=>({id:"asset",companyId,locationId,unitType:"Truck"}),bootstrap:async()=>({companies:[{companyId,locations:[{locationId,modules:{inspections:"full",workorders:"full"}},{locationId:sourceB,modules:{inspections:"read",workorders:"off"}}]}]}),authorizeProduct:async(_context,record,capability)=>{if(record.locationId===sourceB&&capability==="write")throw denied();return{mode:"full"};},authorizeWorkorders:async(_context,record)=>{if(record.locationId===sourceB)throw denied();return{mode:"full"};},readMileage:async()=>({miles:100,observedAt:"2026-10-14T10:00:00Z",source:"manual",version:1,state:"fresh"}),listMaintenance:async()=>[{id:"obligation-b",findingId:"finding-b",inspectionId:"inspection-b",inspectionNumber:"INS-B",note:"Source B",version:1,status:"resolved_workorder",deferral:{reason:"Wait",nextVisit:false,dueDate:null,dueMiles:200,baselineMiles:null,additionalMiles:null,earlyMiles:20},sourceCompletedAt:"2026-10-10T10:00:00Z",sourceLocationId:sourceB,workorderId:"private-b",workorderStatus:"in_progress"}]});
  assert.equal(value.canManage,true);assert.equal(value.canManageWorkorders,true);
  assert.equal(value.items[0].canManage,false);assert.equal(value.items[0].canManageWorkorders,false);
  assert.equal(value.items[0].workorderId,undefined);assert.equal(value.items[0].workorderStatus,undefined);assert.equal(value.items[0].sourceLocationId,undefined);
});

test("a completed subsequent visit keeps next-visit maintenance due in unit context",async()=>{
  const adminContext={...context,actor:{id:userId,role:"admin"},companyRoles:new Map([[companyId,"admin"]])};
  const value=await unitMaintenanceContext(adminContext,"asset",{loadAsset:async()=>({id:"asset",companyId,locationId,unitType:"Truck"}),bootstrap:async()=>({companies:[{companyId,locations:[{locationId,modules:{inspections:"read"}}]}]}),authorizeProduct:async()=>({mode:"full"}),authorizeWorkorders:async()=>({mode:"read"}),readMileage:async()=>({miles:null,observedAt:null,source:null,version:0,state:"unknown"}),listMaintenance:async()=>[{id:"obligation",findingId:"finding",inspectionId:"source",inspectionNumber:"INS-1",note:"Fluid low",version:1,status:"open",deferral:{reason:"Next visit",nextVisit:true,dueDate:null,dueMiles:null,baselineMiles:null,additionalMiles:null,earlyMiles:200,reviewedAt:"2026-10-10T10:00:00Z"},sourceCompletedAt:"2026-10-10T10:00:00Z",visitStartedAt:"2026-10-12T10:00:00Z"}]});
  assert.equal(value.items[0].dueState,"due");assert.equal(value.items[0].visitStartedAt,undefined);
});

test("defer and verify actions stay Office scoped and additional miles require current verified baseline",async()=>{
  const record={id:"source",companyId,locationId,assetId:"asset",unitType:"Truck",status:"completed",assignments:[]};const input={expectedVersion:1,idempotencyKey:"defer-again-001",reason:"Still safe",deferral:{reason:"Still safe",nextVisit:false,dueDate:null,dueMiles:null,baselineMiles:249900,additionalMiles:100,earlyMiles:200}};let command;
  await deferInspectionFollowUp(context,"source","finding",input,{load:async()=>record,authorizeProduct:async()=>{},readMileage:async()=>({miles:249900,state:"fresh"}),resolveFollowUp:async(value)=>(command=value,value)});assert.equal(command.action,"defer");assert.equal(command.deferral.dueMiles,250000);
  await assert.rejects(deferInspectionFollowUp(context,"source","finding",input,{load:async()=>record,authorizeProduct:async()=>{},readMileage:async()=>({miles:249800,state:"fresh"}),resolveFollowUp:async()=>assert.fail()}),(error)=>error.code==="INSPECTION_DEFERRAL_BASELINE_UNVERIFIED");
  const verified=await verifyInspectionFollowUp(context,"source","finding",{expectedVersion:2,idempotencyKey:"verify-defer-001",reason:"Dashboard and component verified"},{load:async()=>record,authorizeProduct:async()=>{},resolveFollowUp:async(value)=>value});assert.equal(verified.action,"verify");
  await assert.rejects(deferInspectionFollowUp(context,"source","finding",{...input,reason:"Audit says something else"},{load:async()=>record,authorizeProduct:async()=>{},resolveFollowUp:async()=>assert.fail()}),(error)=>error.statusCode===400&&error.code==="INSPECTION_DEFERRAL_REASON_MISMATCH");
  await assert.rejects(deferInspectionFollowUp(context,"source","finding",{...input,reason:"Still safe",deferral:{...input.deferral,dueDate:"2026-02-31"}},{load:async()=>record,authorizeProduct:async()=>{},resolveFollowUp:async()=>assert.fail()}),(error)=>error.statusCode===400);
});

test("manual and provider mileage commands require an in-progress truck in inspection scope",async()=>{
  const record={id:"visit",companyId,locationId,assetId:"asset",unitType:"Truck",status:"in_progress",assignments:[]};let manual;const saved=await recordInspectionMileage(context,"visit",{expectedVersion:0,idempotencyKey:"manual-mileage-001",miles:10,observedAt:"2026-10-14T10:00:00Z",reason:"Dashboard verified"},{load:async()=>record,authorizeProduct:async()=>{},recordMileage:async(input)=>(manual=input,{miles:input.miles})});assert.equal(saved.miles,10);assert.equal(manual.inspectionId,"visit");let provider;await acceptInspectionProviderMileage(context,"visit",{expectedVersion:1,idempotencyKey:"provider-mileage-001",reason:"Samsara reading confirmed"},{load:async()=>record,authorizeProduct:async()=>{},acceptProviderMileage:async(input)=>(provider=input,input)});assert.equal(provider.assetId,"asset");await assert.rejects(recordInspectionMileage(context,"visit",{expectedVersion:0,idempotencyKey:"manual-mileage-002",miles:10,observedAt:"2026-10-14T10:00:00Z",reason:"Dashboard verified"},{load:async()=>({...record,status:"completed"}),authorizeProduct:async()=>{},recordMileage:async()=>assert.fail()}),(error)=>error.code==="INSPECTION_MILEAGE_NOT_EDITABLE");
});

test("inspection mileage commands map repository domain errors to API status codes",async()=>{
  const record={id:"visit",companyId,locationId,assetId:"asset",unitType:"Truck",status:"in_progress",assignments:[]};const base={load:async()=>record,authorizeProduct:async()=>{}};
  for(const [code,statusCode] of [["ASSET_MILEAGE_TIME_FUTURE",400],["ASSET_MILEAGE_ASSET_NOT_FOUND",404],["ASSET_MILEAGE_STALE",409]])await assert.rejects(recordInspectionMileage(context,"visit",{expectedVersion:0,idempotencyKey:"manual-mileage-map",miles:10,observedAt:"2026-10-14T10:00:00Z",reason:"Dashboard verified"},{...base,recordMileage:async()=>{throw Object.assign(new Error(code),{code});}}),(error)=>error.code===code&&error.statusCode===statusCode);
});
