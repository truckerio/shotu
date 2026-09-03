import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assignInspection, createInspectionFindingWorkorder, createInspectionPrintArchiveRecord, eligibleInspectionWorkorders, linkInspectionToWorkorder, printInspectionSlip, queryInspectionSummaries,readInspection,requestInspection, reviseInspection } from "./inspection.service.js";
const companyId="11111111-1111-4111-8111-111111111111",locationId="22222222-2222-4222-8222-222222222222",userId="33333333-3333-4333-8333-333333333333";
const context={actor:{id:userId,role:"office"},companyIds:new Set([companyId]),locationIds:new Set([locationId]),companyRoles:new Map([[companyId,"office"]])};
test("office creation authorizes product write before persistence",async()=>{const calls=[];await requestInspection(context,{companyId,locationId,assetId:userId,mechanicUserIds:[]},{authorizeProduct:async(...args)=>calls.push(["auth",...args]),create:async(input)=>(calls.push(["create",input]),input)});assert.equal(calls[0][0],"auth");assert.equal(calls[0][3],"write");});
test("read-only unfinished projection excludes checklist and private notes",async()=>{const inspection={id:"i",companyId,locationId,status:"in_progress",version:2,assignments:[],responses:[{itemKey:"x",response:"issue"}],findings:[{note:"private"}],officeInstructions:"private"};const value=await readInspection(context,"i",{load:async()=>inspection,authorizeProduct:async()=>({mode:"read"})});assert.equal(value.responses,undefined);assert.equal(value.findings,undefined);assert.equal(value.officeInstructions,undefined);});
test("inspection-only completed projection hides linked workorder identity",async()=>{const inspection={id:"i",companyId,locationId,status:"completed",version:2,assignments:[],responses:[],findings:[],workorderLinks:[{workorderId:"secret",workorderSerial:"WO-1"}]};const value=await readInspection(context,"i",{load:async()=>inspection,authorizeProduct:async()=>({mode:"read"}),authorizeWorkorders:async()=>{const error=new Error("denied");error.statusCode=403;throw error;}});assert.equal(value.workorderLinks,undefined);assert.equal(value.workordersLinked,true);});
test("creating an immutable print archive requires inspection write access",async()=>{const inspection={id:"i",companyId,locationId,status:"completed",version:2,inspectionNumber:"INS-1",asset:{unitNo:"1"},templateSnapshot:{sections:[]},responses:[],findings:[],assignments:[]};let capability;await createInspectionPrintArchiveRecord(context,"i",{idempotencyKey:"inspection-print-test"},{load:async()=>inspection,authorizeProduct:async(_context,_scope,next)=>(capability=next,{mode:"full"}),createArchive:async(input)=>({archive:{id:"a",snapshot:input.snapshot}})});assert.equal(capability,"write");});
test("cross-location record returns not found before product authorization",async()=>{const inspection={id:"i",companyId,locationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",status:"completed",assignments:[]};await assert.rejects(readInspection(context,"i",{load:async()=>inspection,authorizeProduct:async()=>assert.fail()}),/not found/i);});
test("mixed-company mechanic scope is enforced in one bounded list query",async()=>{const mechanicCompany="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",officeCompany="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",mechanicLocation="cccccccc-cccc-4ccc-8ccc-cccccccccccc",officeLocation="dddddddd-dddd-4ddd-8ddd-dddddddddddd";const mixed={actor:{id:userId,role:"office"},companyIds:new Set([mechanicCompany,officeCompany]),locationIds:new Set([mechanicLocation,officeLocation]),companyRoles:new Map([[mechanicCompany,"mechanic"],[officeCompany,"office"]])};let listInput;let bootstrapCalls=0;await queryInspectionSummaries(mixed,{limit:25,search:""},{bootstrap:async()=>{bootstrapCalls+=1;return{companies:[{companyId:mechanicCompany,locations:[{locationId:mechanicLocation,modules:{inspections:"full"}}]},{companyId:officeCompany,locations:[{locationId:officeLocation,modules:{inspections:"read"}}]}]};},list:async(input)=>(listInput=input,{items:[]})});assert.equal(bootstrapCalls,1);assert.deepEqual(listInput.restrictedMechanicCompanyIds,[mechanicCompany]);assert.equal(listInput.actorId,userId);assert.deepEqual(listInput.locationIds,[mechanicLocation,officeLocation]);});
test("needs action expands before the bounded queue query", async () => {
  let input; await queryInspectionSummaries(context,{limit:25,search:"",status:"needs_action"},{bootstrap:async()=>({companies:[{companyId,locations:[{locationId,modules:{inspections:"read"}}]}]}),list:async(value)=>(input=value,{items:[]})});
  assert.deepEqual(input.statuses,["requested","assigned"]);
});
test("assignment and workorder link require both product boundaries and carry tenant-scoped inputs", async () => {
  const record={id:"i",companyId,locationId,assetId:"asset",status:"in_progress",version:2,assignments:[]}; const calls=[];
  await assignInspection(context,"i",{expectedVersion:2,mechanicUserIds:[]},{load:async()=>record,authorizeProduct:async(...args)=>calls.push(args),assign:async(input)=>input});
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
  const result=await printInspectionSlip(context,"i",{load:async()=>record,authorizeProduct:async()=>({mode:"read"}),findLatestArchive:async()=>({snapshot,snapshotSha256})});
  assert.equal(result.html,"<html>archived</html>");
});

test("revision and finding-workorder creation require both product capabilities", async () => {
  const record={id:"i",companyId,locationId,assetId:"asset",status:"completed",version:2,assignments:[]}; const calls=[];
  await reviseInspection(context,"i",{expectedVersion:2,reason:"Correct note",mechanicUserIds:[],idempotencyKey:"inspection-revision-001"},{load:async()=>record,authorizeProduct:async(...args)=>calls.push(args),revise:async(input)=>input});
  assert.equal(calls[0][2],"write");
  const progress={...record,status:"in_progress"}; const created=await createInspectionFindingWorkorder(context,"i",{expectedVersion:2,findingIds:["f"],idempotencyKey:"inspection-create-001"},{load:async()=>progress,authorizeProduct:async()=>{},authorizeWorkorders:async()=>{},createWorkorder:async(input)=>input});
  assert.deepEqual(created.findingIds,["f"]);
});
