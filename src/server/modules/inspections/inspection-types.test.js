import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInspectionSchema } from "./inspection.schemas.js";
import { inspectionCreateContext } from "./inspection.service.js";
import { inspectionTemplateDefinitionSchema, assignTemplateSchema, publishInspectionTemplateSchema } from "../templates/template.schemas.js";
import { weeklyInspectionPreset } from "../../../../shared/inspection-template.js";
import { createInspection, inspectionRepositoryInternals } from "../../db/repositories/inspections.repo.js";
import { resolvePublishedTemplateForInspection, saveTemplateAssignment, templateRepositoryInternals } from "../../db/repositories/template-definitions.repo.js";

const companyId="11111111-1111-4111-8111-111111111111", locationId="22222222-2222-4222-8222-222222222222", assetId="33333333-3333-4333-8333-333333333333", actorId="44444444-4444-4444-8444-444444444444";
const input={companyId,locationId,assetId,idempotencyKey:"inspection-type-test",mechanicUserIds:[],officeInstructions:"",actorId,startImmediately:false};
const types=["weekly","annual","pre_trip","post_trip","custom"];
const definition=(inspectionType="weekly")=>({...weeklyInspectionPreset("Truck"),inspectionType,presetKey:inspectionType==="custom"?"custom":`${inspectionType.replaceAll("_","-")}-truck`});

test("create, definition and assignment schemas accept each inspection type and default legacy inputs to weekly",()=>{
  const {actorId:_actor,startImmediately:_start,...request}=input;
  assert.equal(createInspectionSchema.parse(request).inspectionType,"weekly");
  const legacy=definition(); delete legacy.inspectionType;
  assert.equal(inspectionTemplateDefinitionSchema.parse(legacy).inspectionType,"weekly");
  for(const inspectionType of types){
    assert.equal(createInspectionSchema.parse({...request,inspectionType}).inspectionType,inspectionType);
    assert.equal(inspectionTemplateDefinitionSchema.parse(definition(inspectionType)).inspectionType,inspectionType);
    assert.equal(assignTemplateSchema.parse({companyId,familyKey:"inspection",applicabilityKey:"Truck",inspectionType,templateVersionId:assetId,expectedVersion:0}).inspectionType,inspectionType);
  }
  for(const inspectionType of ["monthly","",null]) assert.equal(createInspectionSchema.safeParse({...request,inspectionType}).success,false);
  assert.equal(inspectionTemplateDefinitionSchema.safeParse({...definition("annual"),presetKey:"weekly-truck"}).success,false);
});

test("publishing and repository assignment validation reject a different inspection type",()=>{
  const assignment={companyId,familyKey:"inspection",applicabilityKey:"Truck",inspectionType:"weekly",templateVersionId:assetId,expectedVersion:0};
  assert.equal(publishInspectionTemplateSchema.safeParse({companyId,expectedVersion:1,definition:definition("annual"),assignment}).success,false);
  assert.throws(()=>templateRepositoryInternals.assertInspectionAssignmentMatchesDefinition(assignment,definition("annual")),error=>error.code==="TEMPLATE_ASSIGNMENT_TYPE_MISMATCH");
});

test("weekly request hashing preserves legacy persisted keys and other types cannot replay them",async()=>{
  const legacyHash=createHash("sha256").update(JSON.stringify({companyId,locationId,assetId,mechanicUserIds:[],dueAt:null,officeInstructions:"",startImmediately:false})).digest("hex");
  assert.equal(inspectionRepositoryInternals.inspectionCreateRequestHash(input),legacyHash);
  assert.equal(inspectionRepositoryInternals.inspectionCreateRequestHash({...input,inspectionType:"weekly"}),legacyHash);
  const hashes=types.map(inspectionType=>inspectionRepositoryInternals.inspectionCreateRequestHash({...input,inspectionType}));
  assert.equal(new Set(hashes).size,types.length);
  const client={query:async(sql)=>({rows:sql.startsWith("select inspection_id")?[{inspection_id:assetId,request_sha256:legacyHash}]:[]}),release(){}};
  await assert.rejects(createInspection({...input,inspectionType:"annual"},{pool:{connect:async()=>client}}),error=>error.code==="INSPECTION_CREATE_IDEMPOTENCY_CONFLICT");
});

test("annual creation scopes active lookup, locks and template resolution independently of weekly",async()=>{
  const locks=[]; let scope; let stored;
  const row={id:assetId,company_id:companyId,location_id:locationId,asset_id:assetId,inspection_kind:"annual_truck",unit_type:"Truck",status:"requested",version:1,template_snapshot:definition("annual")};
  const client={async query(sql,values){
    if(sql.startsWith("select pg_advisory")) locks.push(values[0]);
    if(sql.startsWith("select asset.*")) return {rows:[{id:assetId,company_id:companyId,unit_type:"Truck"}]};
    if(sql.startsWith("select id from inspections")){assert.equal(values[2],"annual_truck");return{rows:[]};}
    if(sql.startsWith("insert into inspections")){stored=values;return{rows:[row]};}
    if(sql.includes("from inspections inspection"))return{rows:[row]};
    return{rows:[]};
  },release(){}};
  const result=await createInspection({...input,inspectionType:"annual"},{pool:{connect:async()=>client},resolveTemplate:async(_client,value)=>(scope=value,{id:actorId,definition:definition("annual")}),reserveSerial:async()=>"INS-2"});
  assert.equal(stored[4],"annual_truck"); assert.equal(scope.inspectionType,"annual");
  assert.ok(locks.includes(`${companyId}:${assetId}:annual_truck`));
  assert.equal(result.inspectionType,"annual"); assert.equal(result.templateLabel,definition("annual").label);
});

test("template resolution includes type in both location override and company fallback scopes",async()=>{
  for(const inspectionType of types){let statement;let parameters;
    await resolvePublishedTemplateForInspection({async query(sql,values){if(sql.includes("from template_assignments assignment")){statement=sql;parameters=values;}return{rows:[]};}},{companyId,locationId,unitType:"Truck",inspectionType});
    assert.deepEqual(parameters,[companyId,locationId,"Truck",inspectionType]);
    assert.match(statement,/assignment\.inspection_type=\$4/);
    assert.match(statement,/and applicability_key=\$3 and inspection_type=\$4/);
  }
});

test("standalone assignment rejects an annual version for a weekly scope before changing any assignment",async()=>{
  let updates=0;let checked=false;
  const client={async query(sql,values){
    if(sql.includes("select version.id")){checked=true;assert.match(sql,/coalesce\(version.definition->>'inspectionType','weekly'\)=\$5/);assert.equal(values[4],"weekly");return{rows:[]};}
    if(sql.startsWith("update")||sql.startsWith("insert"))updates++;
    return{rows:[]};
  },release(){}};
  await assert.rejects(saveTemplateAssignment({companyId,locationId,familyKey:"inspection",applicabilityKey:"Truck",inspectionType:"weekly",templateVersionId:assetId,expectedVersion:0,actorId},{pool:{connect:async()=>client}}),error=>error.statusCode===409);
  assert.equal(checked,true);assert.equal(updates,0);
});

test("create context returns templates only for the selected authorized writable location",async()=>{
  const context={actor:{id:actorId,role:"office"},companyIds:new Set([companyId]),locationIds:new Set([locationId]),companyRoles:new Map([[companyId,"office"]])};
  let calls=0;const templates=[{inspectionType:"annual",unitType:"Truck",versionId:assetId,label:"Annual Truck",companyId,locationId}];
  const dependencies={bootstrap:async()=>({companies:[{companyId,locations:[{locationId,modules:{inspections:"full"}},{locationId:assetId,modules:{inspections:"read"}}]}]}),listLocations:async()=>[{companyId,locationId,name:"Yard"},{companyId,locationId:assetId,name:"Other"}],listMechanics:async()=>[],listTemplates:async(scope)=>{calls++;assert.deepEqual(scope,{companyId,locationId});return templates;}};
  assert.deepEqual((await inspectionCreateContext(context,{locationId},dependencies)).templates,templates);
  assert.deepEqual((await inspectionCreateContext(context,{locationId:assetId},dependencies)).templates,[]);
  assert.deepEqual((await inspectionCreateContext(context,{locationId:"unauthorized"},dependencies)).templates,[]);
  assert.equal(calls,1);
  const denied={...dependencies,bootstrap:async()=>({companies:[{companyId,locations:[{locationId,modules:{inspections:"read"}}]}]}),listTemplates:async()=>assert.fail("read-only location must not load create templates")};
  assert.deepEqual((await inspectionCreateContext(context,{locationId},denied)).templates,[]);
});

test("type migration widens kinds and assignment uniqueness without rewriting evidence",async()=>{
  const sql=await readFile(new URL("../../db/migrations/203_inspection_types.sql",import.meta.url),"utf8");
  assert.match(sql,/inspection_type text not null default 'weekly'/);
  assert.match(sql,/on template_assignments\(company_id,family_key,applicability_key,inspection_type\)/);
  assert.match(sql,/on template_assignments\(company_id,location_id,family_key,applicability_key,inspection_type\)/);
  assert.match(sql,/'pre_trip_truck','pre_trip_trailer'/);
  assert.match(sql,/new.inspection_type is distinct from coalesce\(target_definition->>'inspectionType','weekly'\)/);
  assert.doesNotMatch(sql,/update template_versions|update inspections|update inspection_print_archives/i);
});
