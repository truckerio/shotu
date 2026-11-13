import test from "node:test";
import assert from "node:assert/strict";
import { billingForProfile, readBusinessSetup, writeBusinessSetup } from "./business-setup.service.js";
const companyId = "00000000-0000-0000-0000-000000000001";
const locationId = "11111111-1111-1111-1111-111111111111";
const context = { actor: { id: "actor", role: "admin" }, companyIds: new Set([companyId]), companyRoles: new Map([[companyId, "admin"]]), locationIds: new Set(), sessionMode: "standard" };
const profile = { id: "profile", locationId: null, informationalOnly: false, taxProfileVersionId: "tax", taxState: "active", defaultCurrency: "USD", taxCurrency: "USD", lineTaxPolicy: { labor: "exclusive", part: "exclusive", shop_supply: "exempt", fee: "exempt", core_charge: "exempt", credit: "out_of_scope" }, shopIdentity: { legalName: "Published", address: "Address" } };
const deps = { getDefaults: async () => ({ name: "Company", address: "Location" }), getProfile: async () => profile, getSetup: async () => null, getLocation: async () => ({ company_id: companyId }) };
test("reads existing profile identity and computes billing readiness without mutation", async () => {
  const result = await readBusinessSetup(context, { companyId, locationId }, deps);
  assert.deepEqual(result.defaults, { legalName: "Published", address: "Address", phone: "", email: "" });
  assert.deepEqual(result.billing, { ready: true, profileVersionId: "profile", scope: "company" });
  for (const patch of [{ informationalOnly: true }, { taxState: "archived" }, { taxCurrency: "CAD" }, { lineTaxPolicy: {} }]) assert.equal(billingForProfile({ ...profile, ...patch }).ready, false);
});
test("enforces effective role, tenant, and location ownership", async () => {
  await assert.rejects(readBusinessSetup({ ...context, companyRoles: new Map([[companyId, "office"]]) }, { companyId }, deps), { statusCode: 403 });
  await assert.rejects(readBusinessSetup(context, { companyId: locationId }, deps), { statusCode: 403 });
  await assert.rejects(readBusinessSetup(context, { companyId, locationId }, { ...deps, getLocation: async () => ({ company_id: locationId }) }), { statusCode: 404 });
});
test("fleet completion only calls setup persistence", async () => {
  let saved; const input = { companyId, operatingMode: "fleet_only", status: "completed" };
  const result = await writeBusinessSetup(context, input, { ...deps, saveSetup: async (value) => (saved = value) });
  assert.equal(saved, input); assert.equal(result.setup, input);
});
