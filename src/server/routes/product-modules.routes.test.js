import test from "node:test";
import assert from "node:assert/strict";
import { handleProductModulesApi } from "./product-modules.routes.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
function harness(role = "admin", body = {}) { const sent=[]; return { sent, helpers:{ requestContext:{ actor:{ id:"u",role },companyIds:new Set([companyId]),locationIds:new Set([locationId]),companyRoles:new Map([[companyId,role]]) },readBody:async()=>body,sendJson:(_res,status,payload)=>sent.push({status,payload}) } }; }

test("admin can list only the requested product access scope", async () => {
  const h=harness(); let received;
  await handleProductModulesApi({method:"GET"},{},new URL(`http://x/api/admin/product-modules?companyId=${companyId}&locationId=${locationId}`),h.helpers,{getLocation:async()=>({id:locationId,company_id:companyId}),list:async(input)=>(received=input,[{locationId},{locationId:null}])});
  assert.deepEqual(received,{companyIds:[companyId],locationIds:[locationId]}); assert.deepEqual(h.sent[0].payload.rules,[{locationId}]);
});

test("company admin can manage a company-owned location without direct location membership", async () => {
  const h=harness(); h.helpers.requestContext.locationIds = new Set();
  await handleProductModulesApi({method:"GET"},{},new URL(`http://x/api/admin/product-modules?companyId=${companyId}&locationId=${locationId}`),h.helpers,{getLocation:async()=>({id:locationId,company_id:companyId}),list:async()=>[]});
  assert.equal(h.sent[0].status,200);
});

test("non-admin cannot read or mutate product access", async () => {
  const h=harness("office");
  await assert.rejects(handleProductModulesApi({method:"GET"},{},new URL(`http://x/api/admin/product-modules?companyId=${companyId}`),h.helpers,{list:async()=>assert.fail()}),/permission/i);
});

test("role mutation requires explicit optimistic version", async () => {
  const h=harness("admin",{companyId,subjectType:"role",subjectId:"surveillance",moduleKey:"workorders",mode:"off"});
  await assert.rejects(handleProductModulesApi({method:"PATCH"},{},new URL("http://x/api/admin/product-modules"),h.helpers,{patch:async()=>assert.fail()}),/expected number|expectedVersion|Required/i);
});
