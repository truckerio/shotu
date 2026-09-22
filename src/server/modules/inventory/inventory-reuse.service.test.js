import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { commandInventoryReuse, getInventoryReuse, saveInventoryReuseConfiguration } from "./inventory-reuse.service.js";
import { InventoryError } from "./inventory.errors.js";
const companyId=randomUUID(),locationId=randomUUID(),actorId=randomUUID(),usageId=randomUUID();
const context={actor:{id:actorId,role:"office"},companyIds:new Set([companyId]),locationIds:new Set([locationId])};
const payload={companyId,locationId,usageId,reason:"Bench test",expectedVersion:1,idempotencyKey:"remove-test-1"};
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
test("direct removal requires product access and repository capability without workorder-record authorization",async()=>{
  let called=false;
  let productChecks=0,workorderChecks=0;
  const deps={authorizeProduct:async()=>{productChecks+=1;throw new Error("Workorders denied");},authorizeWorkorder:async()=>{workorderChecks+=1;throw new Error("Workorder denied");},mutate:async()=>{called=true;return {case:{}};}};
  await assert.rejects(commandInventoryReuse("remove",null,{...payload,companyId:randomUUID()},context,deps));
  await assert.rejects(commandInventoryReuse("remove",null,{...payload,locationId:randomUUID()},context,deps));
  await assert.rejects(commandInventoryReuse("remove",null,payload,context,deps),/Workorders denied/);
  assert.equal(called,false);
  assert.equal(productChecks,1);
  assert.equal(workorderChecks,0);
});
test("company ownership, receipt and completed inspection require evidence; unknown fields cannot set state",async()=>{
  const deps={...auth,mutate:async()=>{throw new Error("Should not persist invalid payload");}};
  await assert.rejects(commandInventoryReuse("remove",null,{...payload,ownership:"company",ownershipEvidence:" "},context,deps),{name:"ZodError"});
  await assert.rejects(commandInventoryReuse("remove",null,{...payload,status:"released"},context,deps),{name:"ZodError"});
  await assert.rejects(commandInventoryReuse("receive",randomUUID(),{companyId,locationId,idempotencyKey:"receive-test",evidence:""},context,deps),{name:"ZodError"});
  await assert.rejects(commandInventoryReuse("release",randomUUID(),{companyId,locationId,idempotencyKey:"release-test",decision:"release",inspectionEvidence:"",reason:"Okay"},context,deps),{name:"ZodError"});
});
test("reads/configuration carry current actor and explicit scope; repository authority failures propagate",async()=>{
  const scope={companyId,locationId};
  const assetId=randomUUID();
  const result=await getInventoryReuse("asset",scope,assetId,context,{...auth,read:async(input)=>input});
  assert.equal(result.actorId,actorId);assert.equal(result.assetId,assetId);
  const catalogPartId=randomUUID();
  const targetedConfig=await getInventoryReuse("config",{...scope,catalogPartId},"",context,{...auth,read:async(input)=>input});
  assert.equal(targetedConfig.catalogPartId,catalogPartId);
  const caseId=randomUUID();
  const targetedCase=await getInventoryReuse("case",scope,caseId,context,{...auth,read:async(input)=>input});
  assert.equal(targetedCase.caseId,caseId);
  assert.equal(targetedCase.view,"case");
  await assert.rejects(saveInventoryReuseConfiguration("grant",{...scope,userId:actorId,capabilities:["release"],reason:"Grant"},context,{...auth,configure:async()=>{throw new InventoryError("No explicit admin scope",{code:"INVENTORY_REUSE_FORBIDDEN",statusCode:403});}}),{code:"INVENTORY_REUSE_FORBIDDEN"});
});

test("exact custody case reads reject malformed ids and unauthorized tenant or shop scope before persistence",async()=>{
  const deps={...auth,read:async()=>{throw new Error("Unauthorized scope reached the repository");}};
  await assert.rejects(getInventoryReuse("case",{companyId,locationId},"not-a-case",context,deps),{name:"ZodError"});
  await assert.rejects(getInventoryReuse("case",{companyId:randomUUID(),locationId},randomUUID(),context,deps));
  await assert.rejects(getInventoryReuse("case",{companyId,locationId:randomUUID()},randomUUID(),context,deps));
});
test("versioned receive requires an exact unit confirmation before mutation",async()=>{
  let mutated=false;
  await assert.rejects(commandInventoryReuse("receive",randomUUID(),{companyId,locationId,evidence:"seen",expectedVersion:1,idempotencyKey:"receive-versioned-1"},context,{...auth,mutate:async()=>{mutated=true;}}),{name:"ZodError"});
  assert.equal(mutated,false);
});
test("legacy return accepts exact receipt evidence but cannot decide disposition", async () => {
  const caseId = randomUUID();
  const unitId = randomUUID();
  let captured;
  const result = await commandInventoryReuse("return", caseId, {
    companyId, locationId, exactUnitId: unitId, outcome: "reuse", evidence: "Exact unit received at counter",
    expectedVersion: 2, idempotencyKey: "atomic-return-test",
  }, context, { ...auth, mutate: async (input) => { captured = input; return { case: { status: "received_pending_review" } }; } });
  assert.equal(result.case.status, "received_pending_review");
  assert.equal(captured.capability, "receive");
  assert.equal(captured.caseId, caseId);
  assert.equal(captured.exactUnitId, unitId);
  assert.equal(captured.outcome, "reuse");
  await assert.rejects(commandInventoryReuse("return", caseId, {
    companyId, locationId, exactUnitId: unitId, outcome: "invented", evidence: "Received",
    expectedVersion: 2, idempotencyKey: "atomic-return-invalid",
  }, context, { ...auth, mutate: async () => {} }), { name: "ZodError" });
});
test("release requires a selected storage position while hold does not", async () => {
  const caseId=randomUUID(),targetPositionId=randomUUID();
  await assert.rejects(commandInventoryReuse("release",caseId,{
    companyId,locationId,decision:"release",inspectionEvidence:"Bench pass",reason:"Approved",
    expectedVersion:2,idempotencyKey:"release-without-position",
  },context,{...auth,mutate:async()=>{throw new Error("must not persist");}}),{name:"ZodError"});
  const captured=await commandInventoryReuse("release",caseId,{
    companyId,locationId,decision:"release",inspectionEvidence:"Bench pass",reason:"Approved",targetPositionId,
    expectedVersion:2,idempotencyKey:"release-with-position",
  },context,{...auth,mutate:async(input)=>input});
  assert.equal(captured.targetPositionId,targetPositionId);
  assert.equal(captured.capability,"release");
  await commandInventoryReuse("release",caseId,{
    companyId,locationId,decision:"hold",inspectionEvidence:"Failed",reason:"Needs repair",
    expectedVersion:2,idempotencyKey:"hold-without-position",
  },context,{...auth,mutate:async(input)=>input});
});
test("repair completion cannot bypass inspection and target selection", async () => {
  await assert.rejects(commandInventoryReuse("repair_complete",randomUUID(),{
    companyId,locationId,exactUnitId:randomUUID(),evidence:"Repair complete",receiptEvidence:"Unit returned",
    release:true,inspectionEvidence:"Pass",expectedVersion:3,idempotencyKey:"repair-release-shortcut",
  },context,{...auth,mutate:async()=>{throw new Error("must not persist");}}),{name:"ZodError"});
});
test("handoff detail clearing reaches the guarded correction command without becoming a holder transfer", async () => {
  const unitId = randomUUID();
  let captured;
  await commandInventoryReuse("correct_location", null, {
    companyId, locationId, unitId, custodyVersion: 4, expectedVersion: 4,
    holderType: "handoff", binLocation: "", externalReference: "",
    evidence: "Clear stale bin copied from an earlier custody record.", idempotencyKey: "handoff-clear-test",
  }, context, { ...auth, mutate: async (input) => { captured = input; return { unitProjection: {} }; } });
  assert.equal(captured.action, "correct_location");
  assert.equal(captured.capability, "route");
  assert.equal(captured.holderType, "handoff");
  assert.equal(captured.binLocation, "");
});
test("terminal disposition rejects impossible calendar dates before mutation", async () => {
  let mutated = false;
  await assert.rejects(commandInventoryReuse("scrap", randomUUID(), {
    companyId, locationId, expectedVersion: 1, idempotencyKey: "invalid-disposition-date",
    evidence: "Disposed", externalReference: "Scrap yard", dispositionDate: "2026-02-30",
  }, context, { ...auth, mutate: async () => { mutated = true; } }), { name: "ZodError" });
  assert.equal(mutated, false);
});
