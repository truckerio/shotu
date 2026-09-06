import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { handleInventoryReuseApi } from "./inventory-reuse.routes.js";
import { InventoryError } from "../modules/inventory/inventory.errors.js";
import { DEFAULT_COMPANY_ID } from "../db/company.js";
const companyId=randomUUID(),locationId=randomUUID(),actorId=randomUUID(),caseId=randomUUID();
const scope={companyId,locationId};
const context={actor:{id:actorId,role:"office"},companyIds:new Set([companyId]),locationIds:new Set([locationId])};
async function request(path,method,body,deps={},requestContext=context) {
  let result;
  const handled=await handleInventoryReuseApi({method},{},new URL(path,"http://localhost"),{
    requestContext,readBody:async()=>body,sendJson:(_res,status,data)=>{result={status,data};},
  },{authorizeProduct:async()=>{},authorizeWorkorder:async()=>{},...deps});
  return {handled,...result};
}
test("custody routes ignore unrelated paths and reject unsupported methods",async()=>{
  assert.equal((await request("/api/other","GET")).handled,false);
  assert.equal((await request("/api/inventory-reuse","DELETE")).status,405);
});
test("remove, receive and review cross real schemas into guarded mutation service",async()=>{
  const calls=[];const deps={mutate:async(input)=>{calls.push(input);return {case:{id:caseId,status:"hold"},replayed:false};}};
  assert.equal((await request("/api/inventory-reuse/remove","POST",{...scope,usageId:randomUUID(),removalWorkorderId:randomUUID(),reason:"Test",ownership:"unknown",expectedVersion:1,idempotencyKey:"remove-test-1"},deps)).status,200);
  assert.equal((await request(`/api/inventory-reuse/${caseId}/receive`,"POST",{...scope,evidence:"Actual handoff observed",exactUnitId:randomUUID(),expectedVersion:1,idempotencyKey:"receive-test-1"},deps)).status,200);
  assert.equal((await request(`/api/inventory-reuse/${caseId}/review`,"POST",{...scope,decision:"hold",inspectionEvidence:"Damage seen",reason:"Repair needed",expectedVersion:1,idempotencyKey:"hold-test-1"},deps)).status,200);
  assert.deepEqual(calls.map((c)=>c.action),["remove","receive","release"]);
});
test("asset, operation, config and explicit configuration actions map exact endpoint contracts",async()=>{
  const views=[]; const deps={read:async(input)=>{views.push(input.view);return {};},configure:async(input)=>({saved:true,kind:input.kind})};
  const search=`?companyId=${companyId}&locationId=${locationId}`;
  for(const endpoint of ["",`/asset/${randomUUID()}`,"/operations/original-key","/config"]) assert.equal((await request(`/api/inventory-reuse${endpoint}${search}`,"GET",null,deps)).status,200);
  assert.deepEqual(views,["queue","asset","operation","config"]);
  assert.equal((await request("/api/inventory-reuse/config/grant","POST",{...scope,userId:actorId,capabilities:[],reason:"Revoke"},deps)).data.saved,true);
  assert.equal((await request("/api/inventory-reuse/config/policy","POST",{...scope,catalogPartId:randomUUID(),reuseAllowed:false,evidence:"Single use only"},deps)).data.saved,true);
});
test("exact-unit state filters cross the route contract and reject unknown future states",async()=>{
  let readInput;
  const deps={read:async(input)=>{readInput=input;return {items:[]};}};
  const partId=randomUUID();
  const search=`?companyId=${companyId}&locationId=${locationId}&unitState=available`;
  assert.equal((await request(`/api/inventory-reuse/stock/${partId}/units${search}`,"GET",null,deps)).status,200);
  assert.equal(readInput.view,"units");
  assert.equal(readInput.catalogPartId,partId);
  assert.equal(readInput.unitState,"available");
  assert.equal((await request(`/api/inventory-reuse/stock/${partId}/units?companyId=${companyId}&locationId=${locationId}&unitState=transferred`,"GET",null,deps)).status,400);
});
test("asset custody accepts the canonical legacy company UUID without relaxing entity IDs",async()=>{
  const legacyScope={companyId:DEFAULT_COMPANY_ID,locationId};
  const legacyContext={...context,companyIds:new Set([DEFAULT_COMPANY_ID])};
  let readInput;
  const deps={read:async(input)=>{readInput=input;return {installedParts:[]};}};
  const assetId=randomUUID();
  const search=`?companyId=${DEFAULT_COMPANY_ID}&locationId=${locationId}`;
  assert.equal((await request(`/api/inventory-reuse/asset/${assetId}${search}`,"GET",null,deps,legacyContext)).status,200);
  assert.equal(readInput.companyId,DEFAULT_COMPANY_ID);
  assert.equal((await request(`/api/inventory-reuse/asset/not-an-id${search}`,"GET",null,deps,legacyContext)).status,400);
  assert.equal((await request(`/api/inventory-reuse/asset/${assetId}?companyId=not-a-company&locationId=${locationId}`,"GET",null,deps,legacyContext)).status,400);
});
test("schema and guarded transition errors retain actionable statuses without raw failure leaks",async()=>{
  assert.equal((await request("/api/inventory-reuse/remove","POST",scope)).status,400);
  const result=await request(`/api/inventory-reuse/${caseId}/receive`,"POST",{...scope,evidence:"Observed",exactUnitId:randomUUID(),expectedVersion:1,idempotencyKey:"receive-test-1"},{mutate:async()=>{throw new InventoryError("Exact unit changed",{code:"INVENTORY_REUSE_CHANGED",statusCode:409});}});
  assert.equal(result.status,409);assert.equal(result.data.code,"INVENTORY_REUSE_CHANGED");
});
