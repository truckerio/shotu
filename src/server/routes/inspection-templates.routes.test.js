import test from "node:test";
import assert from "node:assert/strict";
import { handleInspectionTemplatesApi } from "./inspection-templates.routes.js";
import { weeklyInspectionPreset } from "../../../shared/inspection-template.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
function harness(body={}) { const sent=[]; return {sent,helpers:{requestContext:{actor:{id:"u"}},readBody:async()=>body,sendJson:(_res,status,payload)=>sent.push({status,payload})}}; }

test("weekly template creation rejects annual and accepts the canonical preset", async () => {
  const invalid=harness({companyId,name:"Annual",applicabilityKey:"Truck",presetKey:"annual",definition:weeklyInspectionPreset("Truck")});
  await assert.rejects(handleInspectionTemplatesApi({method:"POST"},{},new URL("http://x/api/admin/inspection-templates"),invalid.helpers,{create:async()=>assert.fail()}),/Invalid option|preset/i);
  const valid=harness({companyId,name:"Weekly Truck",applicabilityKey:"Truck",presetKey:"weekly-truck",definition:weeklyInspectionPreset("Truck")}); let received;
  await handleInspectionTemplatesApi({method:"POST"},{},new URL("http://x/api/admin/inspection-templates"),valid.helpers,{create:async(_context,input)=>(received=input,{version:{id:versionId}})});
  assert.equal(received.definition.assetType,"Truck"); assert.equal(valid.sent[0].status,201);
});

test("template creation rejects a preset or definition for the wrong unit type", async () => {
  const mismatched=harness({companyId,name:"Wrong unit",applicabilityKey:"Truck",presetKey:"weekly-trailer",definition:weeklyInspectionPreset("Trailer")});
  await assert.rejects(handleInspectionTemplatesApi({method:"POST"},{},new URL("http://x/api/admin/inspection-templates"),mismatched.helpers,{create:async()=>assert.fail()}),/unit type|preset/i);
});

test("publish uses one atomic service operation and revisions require the published version", async () => {
  const definition=weeklyInspectionPreset("Truck");
  const atomic=harness({companyId,expectedVersion:2,definition,assignment:{companyId,locationId:null,familyKey:"inspection",applicabilityKey:"Truck",templateVersionId:versionId,expectedVersion:0}}); let published;
  await handleInspectionTemplatesApi({method:"POST"},{},new URL(`http://x/api/admin/inspection-templates/${versionId}/publish`),atomic.helpers,{publishAndAssign:async(_context,...input)=>(published=input,{version:{id:versionId},assignment:{id:"a"}})});
  assert.equal(published[0],companyId); assert.equal(published[2],2); assert.equal(published[3].label,definition.label); assert.equal(atomic.sent[0].payload.assignment.id,"a");
  const revision=harness({expectedVersion:2}); let received;
  revision.helpers.readBody=async()=>({companyId,expectedVersion:2}); await handleInspectionTemplatesApi({method:"POST"},{},new URL(`http://x/api/admin/inspection-templates/${versionId}/revisions`),revision.helpers,{createRevision:async(_context,...input)=>(received=input,{id:"draft"})});
  assert.deepEqual(received,[companyId,versionId,2]); assert.equal(revision.sent[0].status,201);
});

test("publish rejects template assignment mismatches in both unit-type directions", async () => {
  for (const [definitionType, assignmentType] of [["Truck", "Trailer"], ["Trailer", "Truck"]]) {
    const definition=weeklyInspectionPreset(definitionType);
    const request=harness({companyId,expectedVersion:2,definition,assignment:{companyId,locationId:null,familyKey:"inspection",applicabilityKey:assignmentType,templateVersionId:versionId,expectedVersion:0}});
    await assert.rejects(
      handleInspectionTemplatesApi({method:"POST"},{},new URL(`http://x/api/admin/inspection-templates/${versionId}/publish`),request.helpers,{publishAndAssign:async()=>assert.fail("mismatched assignment must not reach the service")}),
      /assignment unit type/i,
    );
  }
});

test("assignment recovery is strict, tenant-scoped through the admin service, and versioned", async () => {
  const input={companyId,locationId:null,familyKey:"inspection",applicabilityKey:"Truck",templateVersionId:versionId,expectedVersion:0}; const request=harness(input); let received;
  await handleInspectionTemplatesApi({method:"POST"},{},new URL("http://x/api/admin/inspection-templates/assignments"),request.helpers,{assign:async(_context,value)=>(received=value,{id:"assignment-1"})});
  assert.deepEqual(received,input); assert.equal(request.sent[0].payload.assignment.id,"assignment-1");
  const invalid=harness({...input,familyKey:"other"});
  await assert.rejects(handleInspectionTemplatesApi({method:"POST"},{},new URL("http://x/api/admin/inspection-templates/assignments"),invalid.helpers,{assign:async()=>assert.fail()}),/Invalid literal|inspection/i);
});

test("archive route requires a versioned complete replacement command",async()=>{const replacementVersionId="33333333-3333-4333-8333-333333333333",assignmentId="44444444-4444-4444-8444-444444444444";const request=harness({companyId,expectedVersion:4,idempotencyKey:"template-archive-001",replacements:[{assignmentId,expectedVersion:2,replacementVersionId}]});let received;await handleInspectionTemplatesApi({method:"POST"},{},new URL(`http://x/api/admin/inspection-templates/${versionId}/archive`),request.helpers,{archive:async(_context,...args)=>(received=args,{version:{id:versionId,state:"archived"}})});assert.equal(received[0],companyId);assert.equal(received[1],versionId);assert.equal(received[2].replacements[0].assignmentId,assignmentId);const duplicate=harness({companyId,expectedVersion:4,idempotencyKey:"template-archive-002",replacements:[{assignmentId,expectedVersion:2,replacementVersionId},{assignmentId,expectedVersion:2,replacementVersionId}]});await assert.rejects(handleInspectionTemplatesApi({method:"POST"},{},new URL(`http://x/api/admin/inspection-templates/${versionId}/archive`),duplicate.helpers,{archive:async()=>assert.fail()}),/only once/i);});
