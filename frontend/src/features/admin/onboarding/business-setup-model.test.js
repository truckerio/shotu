import test from "node:test";
import assert from "node:assert/strict";
import { setupDraft, usesCustomerBilling, businessSetupUrl } from "./business-setup-model.js";

test("fleet-only setup never requests a billing step", () => {
  assert.equal(usesCustomerBilling("fleet_only"), false);
  assert.equal(usesCustomerBilling(""), false);
  assert.equal(usesCustomerBilling("customer_repairs"), true);
  assert.equal(usesCustomerBilling("both"), true);
});
test("resume keeps saved identity ahead of suggested defaults", () => {
  const saved = { legalName: "Saved", address: "Saved address", phone: "", email: "" };
  assert.deepEqual(setupDraft({ setup: { operatingMode: "fleet_only", shopIdentity: saved }, defaults: { legalName: "Other" } }).shopIdentity, saved);
  assert.equal(setupDraft({ setup: null, defaults: { legalName: "Company" } }).shopIdentity.legalName, "Company");
});
test("setup navigation preserves the selected company and location", () => {
  const url = new URL(businessSetupUrl("company&x", "location"), "http://localhost");
  assert.equal(url.searchParams.get("commercialCompany"), "company&x");
  assert.equal(url.searchParams.get("commercialLocation"), "location");
  assert.equal(url.searchParams.get("settingsTab"), "business");
});
