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
