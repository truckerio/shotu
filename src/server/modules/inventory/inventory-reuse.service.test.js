import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { commandInventoryReuse, getInventoryReuse, saveInventoryReuseConfiguration } from "./inventory-reuse.service.js";
import { InventoryError } from "./inventory.errors.js";
const companyId=randomUUID(),locationId=randomUUID(),actorId=randomUUID(),usageId=randomUUID(),removalWorkorderId=randomUUID();
const context={actor:{id:actorId,role:"office"},companyIds:new Set([companyId]),locationIds:new Set([locationId])};
const payload={companyId,locationId,usageId,removalWorkorderId,reason:"Bench test",ownership:"company",ownershipEvidence:"Purchase verified",idempotencyKey:"remove-test-1"};
const auth={authorizeProduct:async()=>{},authorizeWorkorder:async()=>{}};
test("removal schema freezes command identity, evidence, actor, scope and stable replay hash",async()=>{
  const calls=[];
  const deps={...auth,mutate:async(input)=>{calls.push(input);return {case:{id:"case"},replayed:calls.length>1};}};
  assert.equal((await commandInventoryReuse("remove",null,payload,context,deps)).replayed,false);
  assert.equal((await commandInventoryReuse("remove",null,{...payload},context,deps)).replayed,true);
  assert.equal(calls[0].requestHash,calls[1].requestHash);
  assert.equal(calls[0].actorId,actorId);
  assert.equal(calls[0].usageId,usageId);
  await commandInventoryReuse("remove",null,{...payload,reason:"Different details"},context,deps);
  assert.notEqual(calls[2].requestHash,calls[0].requestHash);
});
test("module denial, cross-company and location requests fail before persistence",async()=>{
  let called=false;
  const deps={...auth,mutate:async()=>{called=true;}};
  await assert.rejects(commandInventoryReuse("remove",null,{...payload,companyId:randomUUID()},context,deps));
  await assert.rejects(commandInventoryReuse("remove",null,{...payload,locationId:randomUUID()},context,deps));
  await assert.rejects(commandInventoryReuse("remove",null,payload,context,{...deps,authorizeWorkorder:async()=>{throw new Error("Denied");}}));
  assert.equal(called,false);
});
test("company ownership, receipt and completed inspection require evidence; unknown fields cannot set state",async()=>{
  const deps={...auth,mutate:async()=>{throw new Error("Should not persist invalid payload");}};
  await assert.rejects(commandInventoryReuse("remove",null,{...payload,ownershipEvidence:" "},context,deps),{name:"ZodError"});
  await assert.rejects(commandInventoryReuse("remove",null,{...payload,status:"released"},context,deps),{name:"ZodError"});
  await assert.rejects(commandInventoryReuse("receive",randomUUID(),{companyId,locationId,idempotencyKey:"receive-test",evidence:""},context,deps),{name:"ZodError"});
  await assert.rejects(commandInventoryReuse("release",randomUUID(),{companyId,locationId,idempotencyKey:"release-test",decision:"release",inspectionEvidence:"",reason:"Okay"},context,deps),{name:"ZodError"});
});
test("reads/configuration carry current actor and explicit scope; repository authority failures propagate",async()=>{
  const scope={companyId,locationId};
  const assetId=randomUUID();
  const result=await getInventoryReuse("asset",scope,assetId,context,{...auth,read:async(input)=>input});
  assert.equal(result.actorId,actorId);assert.equal(result.assetId,assetId);
  await assert.rejects(saveInventoryReuseConfiguration("grant",{...scope,userId:actorId,capabilities:["release"],reason:"Grant"},context,{...auth,configure:async()=>{throw new InventoryError("No explicit admin scope",{code:"INVENTORY_REUSE_FORBIDDEN",statusCode:403});}}),{code:"INVENTORY_REUSE_FORBIDDEN"});
});
