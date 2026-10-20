import assert from "node:assert/strict";
import test from "node:test";
import { createCustomer, updateCustomerContact } from "./customer-directory.service.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const otherCompanyId = "22222222-2222-4222-8222-222222222222";
const customerId = "33333333-3333-4333-8333-333333333333";
const contactId = "44444444-4444-4444-8444-444444444444";

const context = (role = "office") => ({
  actor: { id: "55555555-5555-4555-8555-555555555555", role },
  companyIds: new Set([companyId]), locationIds: new Set(),
});

test("customer directory writes are Office/Admin tenant scoped", async () => {
  await assert.rejects(createCustomer(context("mechanic"), { companyId, name: "Fleet" }, {
    createCustomer: () => { throw new Error("repository should not be reached"); },
  }), { statusCode: 403 });
  await assert.rejects(createCustomer(context(), { companyId: otherCompanyId, name: "Fleet" }, {
    createCustomer: () => { throw new Error("repository should not be reached"); },
  }));
  let command;
  await createCustomer(context(), { companyId, name: "Fleet" }, {
    createCustomer: async (input) => { command = input; return { id: customerId }; },
  });
  assert.equal(command.actorId, context().actor.id);
  assert.equal(command.companyId, companyId);
});

test("contact update requires a positive expected version and reports stale edits", async () => {
  const input = { companyId, name: "Sam", email: "sam@example.com", version: 2 };
  await assert.rejects(updateCustomerContact(context(), customerId, contactId, input, {
    updateContact: async () => null,
  }), { statusCode: 409, code: "CUSTOMER_DIRECTORY_VERSION_CONFLICT" });
});

test("mechanic directory reads remain company-scoped and revoked memberships fail", async () => {
  const { listCustomers, listCustomerContacts } = await import("./customer-directory.service.js");
  let received;
  await listCustomers(context("mechanic"), { companyId }, { listCustomers: async (value) => { received = value; return []; } });
  assert.equal(received.companyId, companyId);
  await listCustomerContacts(context("mechanic"), customerId, { companyId }, { listContacts: async (value) => { received = value; return []; } });
  assert.equal(received.customerId, customerId);
  await assert.rejects(listCustomers(context("mechanic"), { companyId: otherCompanyId }, { listCustomers: () => assert.fail("Cross-tenant read") }));
  await assert.rejects(listCustomers({ ...context("mechanic"), sessionMode: "standard", companyRoles: new Map() }, { companyId }, { listCustomers: () => assert.fail("Revoked read") }));
});
