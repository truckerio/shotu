import assert from "node:assert/strict";
import test from "node:test";
import { customerContactSummary, customerDirectoryCompanyId, customerMatchesSearch } from "./customers-directory-model.js";

test("customer directory uses the actor's canonical company scope", () => {
  assert.equal(customerDirectoryCompanyId({ companyMemberships: [{ companyId: "company-membership" }], companyIds: ["company-id"] }), "company-membership");
  assert.equal(customerDirectoryCompanyId({ companyIds: ["company-id"] }), "company-id");
});

test("customer contact summary preserves useful first-contact context", () => {
  assert.equal(customerContactSummary(null), "Loading contacts…");
  assert.equal(customerContactSummary([]), "No contacts on file");
  assert.equal(customerContactSummary([{ name: "Jamie", email: "jamie@example.test", phone: "555-0100" }]), "Jamie · jamie@example.test · 555-0100");
});

test("customer search matches name and address", () => {
  const customer = { name: "Long Haul Logistics", address: "1200 Main Street" };
  assert.equal(customerMatchesSearch(customer, "haul"), true);
  assert.equal(customerMatchesSearch(customer, "main"), true);
  assert.equal(customerMatchesSearch(customer, "other"), false);
});
