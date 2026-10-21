import test from "node:test";
import assert from "node:assert/strict";
import { createInspectionSchema } from "./inspection.schemas.js";
import { createInspection, inspectionRepositoryInternals as internals } from "../../db/repositories/inspections.repo.js";
const companyId="11111111-1111-4111-8111-111111111111", locationId="22222222-2222-4222-8222-222222222222", customerId="33333333-3333-4333-8333-333333333333", assetId="44444444-4444-4444-8444-444444444444";
const input={companyId,locationId,assetId,actorId:customerId,idempotencyKey:"report-identity-test",mechanicUserIds:[]};

test("optional report customer inputs validate and preserve legacy create hashes",()=>{
  const {actorId,...request}=input;
  assert.equal(createInspectionSchema.parse({...request,customerCompanyName:"  Acme  ",customerAddress:" A\nB "}).customerCompanyName,"Acme");
  assert.equal(createInspectionSchema.safeParse({...request,customerAccountId:"bad"}).success,false);
  assert.equal(createInspectionSchema.safeParse({...request,customerAddress:"x".repeat(1001)}).success,false);
  assert.equal(internals.inspectionCreateRequestHash(input),internals.inspectionCreateRequestHash({...input,customerCompanyName:" ",customerAddress:""}));
  assert.notEqual(internals.inspectionCreateRequestHash(input),internals.inspectionCreateRequestHash({...input,customerAccountId:customerId}));
  assert.equal(internals.inspectionCreateRequestHash({...input,customerCompanyName:" Acme "}),internals.inspectionCreateRequestHash({...input,customerCompanyName:"Acme"}));
});

test("selected carrier name stays authoritative while address override stays report-only and tenant scoped",async()=>{
  let parameters;const sqls=[];
  const db={async query(sql,values){sqls.push(sql);parameters=values;return{rows:[{id:customerId,name:"Saved carrier",address:"Saved address"}]};}};
  const carrier=await internals.resolveInspectionReportCarrier(db,{...input,customerAccountId:customerId,customerCompanyName:"Spoof",customerAddress:"Spoof address"},{});
  assert.deepEqual(parameters,[companyId,customerId]);
  assert.deepEqual(carrier,{customerAccountId:customerId,name:"Saved carrier",address:"Spoof address",source:"customer_directory",addressSource:"manual"});
  assert.ok(sqls.every(sql=>sql.startsWith("select ")));
  await assert.rejects(internals.resolveInspectionReportCarrier({query:async()=>({rows:[]})},{...input,customerAccountId:customerId},{}),error=>error.code==="INSPECTION_CUSTOMER_INVALID");
  await assert.rejects(internals.resolveInspectionReportCarrier({query:async()=>assert.fail()},{...input,customerAccountId:"invalid"},{}),error=>error.code==="INSPECTION_CUSTOMER_INVALID");
});

test("selected carrier address can be cleared explicitly without changing legacy omitted-address behavior",async()=>{
  const db={query:async()=>({rows:[{id:customerId,name:"Saved carrier",address:"Saved address"}]})};
  const selected={...input,customerAccountId:customerId};
  const omitted=await internals.resolveInspectionReportCarrier(db,selected,{});
  const cleared=await internals.resolveInspectionReportCarrier(db,{...selected,customerAddress:"   "},{});
  assert.equal(omitted.address,"Saved address");assert.equal(omitted.addressSource,undefined);
  assert.equal(cleared.address,"");assert.equal(cleared.addressSource,"manual");
  assert.notEqual(internals.inspectionCreateRequestHash(selected),internals.inspectionCreateRequestHash({...selected,customerAddress:""}));
  assert.equal(internals.inspectionCreateRequestHash({...selected,customerAddress:" "}),internals.inspectionCreateRequestHash({...selected,customerAddress:""}));
  const same=await internals.resolveInspectionReportCarrier(db,{...selected,customerAddress:"Saved address"},{});
  assert.equal(same.addressSource,undefined);
});

test("missing saved address uses explicit report-only address and manual and owner fallbacks never use GPS",async()=>{
  const carrier=await internals.resolveInspectionReportCarrier({query:async()=>({rows:[{id:customerId,name:"Saved carrier",address:null}]})},{...input,customerAccountId:customerId,customerAddress:"Report address"},{});
  assert.equal(carrier.address,"Report address");assert.equal(carrier.addressSource,"manual");
  const noQuery={query:async()=>assert.fail("Fallback must not write or query directory")};
  assert.deepEqual(await internals.resolveInspectionReportCarrier(noQuery,{...input,customerCompanyName:" Manual ",customerAddress:" Address "},{owner_name:"Other"}),{name:"Manual",address:"Address",source:"manual"});
  assert.deepEqual(await internals.resolveInspectionReportCarrier(noQuery,input,{provider:"samsara",owner_name:" Fleet ",raw_provider_data:{location:{address:"GPS"}}}),{name:"Fleet",address:"",source:"samsara_owner"});
  assert.equal(await internals.resolveInspectionReportCarrier(noQuery,input,{provider:"manual",raw_provider_data:{location:{address:"GPS"}}}),null);
});

test("foreign customer is rejected before active inspection dedupe",async()=>{
  let deduped=false;
  const client={async query(sql){
    if(sql.startsWith("select asset.*"))return{rows:[{unit_type:"Truck"}]};
    if(sql.includes("from customer_directory_customers"))return{rows:[]};
    if(sql.startsWith("select id from inspections")){deduped=true;return{rows:[{id:assetId}]};}
    return{rows:[]};
  },release(){}};
  await assert.rejects(createInspection({...input,customerAccountId:customerId},{pool:{connect:async()=>client}}),error=>error.code==="INSPECTION_CUSTOMER_INVALID");
  assert.equal(deduped,false);
});

test("active inspection carrier cannot be silently replaced by a new create request",async()=>{
  let commandRecorded=false;
  const client={async query(sql){
    if(sql.startsWith("select asset.*"))return{rows:[{unit_type:"Truck"}]};
    if(sql.startsWith("select id from inspections"))return{rows:[{id:assetId}]};
    if(sql.includes("from inspections inspection"))return{rows:[{id:assetId,company_id:companyId,version:1,asset_snapshot:{reportCarrier:{name:"Original",address:"A",source:"manual"}}}]};
    if(sql.startsWith("insert into inspection_create_commands"))commandRecorded=true;
    return{rows:[]};
  },release(){}};
  await assert.rejects(createInspection({...input,customerCompanyName:"Changed"},{pool:{connect:async()=>client}}),error=>error.code==="INSPECTION_ACTIVE_CARRIER_CONFLICT");
  assert.equal(commandRecorded,false);
  const same=await createInspection({...input,customerCompanyName:"Original",customerAddress:"A"},{pool:{connect:async()=>client}});
  assert.equal(same.id,assetId);assert.equal(commandRecorded,true);
});

async function archivedIdentity({kind,predecessorInspector,primary={id:"primary",name:"Assigned mechanic"}}={}){
  let snapshot;
  const row={id:assetId,company_id:companyId,location_id:locationId,asset_id:assetId,inspection_number:"INS-1",status:"completed",result:"passed",template_snapshot:{sections:[]},asset_snapshot:{reportCarrier:{name:"Carrier <unsafe>",address:"Street\nTown",source:"manual"}},...(kind?{lineage_kind:kind,predecessor_inspection_id:customerId}:{})};
  const client={async query(sql,values){
    if(sql.startsWith("select archive.*"))return{rows:[{id:"previous",revision_number:1,snapshot:predecessorInspector?{inspector:predecessorInspector}:{}}]};
    if(sql.startsWith("select exists(select 1 from inspections prior")){
      assert.match(sql,/assignment.assignment_role='primary'/);assert.match(sql,/assignment.company_id=\$1/);
      return{rows:[{previous_report_available:false,inspector:primary,location_name:"Shop"}]};
    }
    if(sql.startsWith("insert into inspection_print_archives")){snapshot=JSON.parse(values[8]);return{rows:[{id:"archive",snapshot}]};}
    return{rows:[]};
  }};
  await internals.archiveCompletedInspection(client,row,[],[],customerId);
  return snapshot;
}

test("completion archives assigned primary identity and carrier without fabricating inspector authority",async()=>{
  const snapshot=await archivedIdentity();
  assert.deepEqual(snapshot.inspector,{id:"primary",name:"Assigned mechanic"});
  assert.deepEqual(snapshot.inspectionLocation,{name:"Shop"});
  assert.equal(snapshot.unit.reportCarrier.name,"Carrier <unsafe>");
  const unassigned=await archivedIdentity({primary:null});assert.equal(unassigned.inspector,undefined);
});

test("corrections preserve archived inspector and legacy unknown identity while reinspections capture new primary",async()=>{
  const original={id:"original",name:"Original inspector"};
  assert.deepEqual((await archivedIdentity({kind:"correction",predecessorInspector:original})).inspector,original);
  assert.equal((await archivedIdentity({kind:"correction"})).inspector,undefined);
  const next={id:"next",name:"New inspector"};
  assert.deepEqual((await archivedIdentity({kind:"reinspection",primary:next})).inspector,next);
});

test("new inspection persists selected carrier only in its asset snapshot",async()=>{
  let savedAsset;const statements=[];
  const client={async query(sql,values){
    statements.push(sql);
    if(sql.startsWith("select asset.*"))return{rows:[{unit_type:"Truck",unit_no:"T-1"}]};
    if(sql.includes("from customer_directory_customers"))return{rows:[{id:customerId,name:"Canonical carrier",address:"A\nB"}]};
    if(sql.startsWith("insert into inspections(")){savedAsset=JSON.parse(values[10]);return{rows:[{id:assetId,company_id:companyId,version:1}]};}
    if(sql.includes("from inspections inspection"))return{rows:[{id:assetId,company_id:companyId,version:1,asset_snapshot:savedAsset}]};
    return{rows:[]};
  },release(){}};
  const record=await createInspection({...input,customerAccountId:customerId,customerCompanyName:"Untrusted label"},{pool:{connect:async()=>client},resolveTemplate:async()=>({id:customerId,definition:{sections:[]}}),reserveSerial:async()=>"INS-2"});
  assert.deepEqual(savedAsset.reportCarrier,{customerAccountId:customerId,name:"Canonical carrier",address:"A\nB",source:"customer_directory"});
  assert.deepEqual(record.asset.reportCarrier,savedAsset.reportCarrier);
  assert.equal(statements.some(sql=>/^(insert into|update) customer_directory/.test(sql)),false);
});
