import test from "node:test";
import assert from "node:assert/strict";
import { archiveInspectionTemplate, assignInspectionTemplate } from "./template.service.js";

const companyId="11111111-1111-4111-8111-111111111111",versionId="22222222-2222-4222-8222-222222222222",actorId="33333333-3333-4333-8333-333333333333";
const input={expectedVersion:2,idempotencyKey:"template-archive-001",replacements:[]};
test("only the same-company Admin can archive an inspection template",async()=>{const admin={actor:{id:actorId},companyIds:new Set([companyId]),companyRoles:new Map([[companyId,"admin"]])};const value=await archiveInspectionTemplate(admin,companyId,versionId,input,{archive:async(value)=>value});assert.equal(value.actorId,actorId);assert.equal(value.companyId,companyId);for(const context of [{...admin,companyRoles:new Map([[companyId,"office"]])},{...admin,companyIds:new Set(),companyRoles:new Map([[companyId,"admin"]])},{...admin,companyRoles:new Map([["44444444-4444-4444-8444-444444444444","admin"]])}])await assert.rejects(archiveInspectionTemplate(context,companyId,versionId,input,{archive:async()=>assert.fail()}),/permission|access|company/i);});

test("template location authorization uses the target company role", async () => {
  const otherCompanyId = "44444444-4444-4444-8444-444444444444";
  const locationId = "55555555-5555-4555-8555-555555555555";
  const mixed = { actor: { id: actorId, role: "admin" }, companyIds: new Set([companyId, otherCompanyId]), companyRoles: new Map([[companyId, "admin"], [otherCompanyId, "mechanic"]]), locationIds: new Set() };
  const assigned = await assignInspectionTemplate(mixed, { companyId, locationId }, { assign: async (value) => value });
  assert.equal(assigned.locationId, locationId);
  await assert.rejects(assignInspectionTemplate(mixed, { companyId: otherCompanyId, locationId }, { assign: async () => assert.fail() }), /permission/i);
});
