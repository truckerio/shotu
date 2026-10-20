import assert from "node:assert/strict";
import test from "node:test";
import { createMechanicCustomerIntake } from "./workorder-module-runtime.service.js";
import { createUserWorkorderDraft, submitUserWorkorderDraft } from "./workorder-drafts.service.js";

const context = (role = "mechanic") => ({ actor: { id: "mechanic-1", role }, companyIds: new Set(["company-1"]), companyRoles: new Map([["company-1", role]]), locationIds: new Set(["location-1"]) });
const input = () => ({ companyId: "company-1", locationId: "location-1", concern: "Inspect brakes", mechanicUserIds: ["other-mechanic"], authorizationClassification: "approval_not_required", formData: { customerCompanyName: "Customer fleet", unitNo: "T1", mechanicConcern: "Inspect brakes", parts: [], customerDocumentAdjustments: { discount: 100 } } });
const denied = () => assert.fail("Persistence must not run");

test("customer intake stores work in an Office draft with server-owned approval and assignment", async () => {
  let saved; let authorized;
  const result = await createMechanicCustomerIntake(context(), input(), input(), {
    authorizeCreate: async (...args) => { authorized = args; },
    createDraft: async (value) => { saved = value; return { id: "draft-1" }; },
  });
  assert.equal(result.id, "draft-1");
  assert.equal(authorized[1].companyId, "company-1");
  assert.equal(saved.authorizationClassification, "required_external_customer");
  assert.equal(saved.payload.authorizationExceptionReason, null);
  assert.equal(saved.payload.intakeSource, "mechanic_customer");
  assert.deepEqual(saved.payload.mechanicUserIds, ["mechanic-1"]);
  assert.equal(saved.payload.formData.customerCompanyName, "Customer fleet");
  assert.equal(saved.payload.formData.customerDocumentAdjustments, undefined);
  assert.equal(saved.payload.concern, "Inspect brakes");
});

test("intake rejects other roles, stale membership, cross-tenant/location and pricing injection", async () => {
  for (const [ctx, data] of [
    [context("office"), input()], [context("surveillance"), input()],
    [{ ...context(), companyRoles: new Map() }, input()],
    [context(), { ...input(), companyId: "other-company" }],
    [context(), { ...input(), locationId: "other-location" }],
    [context(), { ...input(), pricing: { parts: [] } }],
    [context(), { ...input(), formData: {} }],
  ]) await assert.rejects(createMechanicCustomerIntake(ctx, data, data, { authorizeCreate: async () => {}, createDraft: denied }));
  await assert.rejects(createMechanicCustomerIntake(context(), input(), input(), { authorizeCreate: async () => { throw new Error("Module denied"); }, createDraft: denied }), /Module denied/);
});

test("selected customer and contact must belong to current company", async () => {
  const data = { ...input(), formData: { ...input().formData, customerAccountId: "other-customer" } };
  await assert.rejects(createMechanicCustomerIntake(context(), data, data, { authorizeCreate: async () => {}, listCustomers: async () => [], createDraft: denied }), /selected customer/);
  data.formData.customerAccountId = "customer-1";
  data.formData.customerContactId = "other-contact";
  await assert.rejects(createMechanicCustomerIntake(context(), data, data, { authorizeCreate: async () => {}, listCustomers: async () => [{ id: "customer-1", contacts: [] }], createDraft: denied }), /selected customer/);
});

test("intake does not grant mechanic commercial draft creation or submission", async () => {
  await assert.rejects(createUserWorkorderDraft(context(), {}, { createDraft: denied }));
  await assert.rejects(submitUserWorkorderDraft(context(), "draft-1", { version: 1 }, { submitDraft: denied }));
});
