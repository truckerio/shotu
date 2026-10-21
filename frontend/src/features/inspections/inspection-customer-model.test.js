import assert from "node:assert/strict";
import test from "node:test";
import { inspectionCustomerIdentity, inspectionCustomerMatches, inspectionCustomerSuggestions, inspectionCustomerValidation } from "./inspection-customer-model.js";

const customers = [
  { id: "a", name: "Carrier", address: "123 Main St\nChino, CA 91710" },
  { id: "b", name: "Duplicate", address: "North yard" },
  { id: "c", name: "Duplicate", address: "South yard" },
  { id: "d", name: "No Address", address: "" },
];

test("a unique exact company match links its authoritative identity and prefills the full address", () => {
  const result = inspectionCustomerIdentity({ customers, customerCompanyName: " carrier " });
  assert.equal(result.customerAccountId, "a");
  assert.equal(result.customerCompanyName, "Carrier");
  assert.equal(result.customerAddress, customers[0].address);

});

test("duplicate names require explicit identity and never guess a customer's address", () => {
  const unselected = inspectionCustomerIdentity({ customers, customerCompanyName: "Duplicate" });
  assert.equal(unselected.ambiguous, true);
  assert.equal(unselected.customerAccountId, "");
  assert.equal(unselected.customerAddress, "");
  const selected = inspectionCustomerIdentity({ customers, customerCompanyName: "Duplicate", customerAccountId: "c" });
  assert.equal(selected.ambiguous, false);
  assert.equal(selected.customerAddress, "South yard");
  assert.equal(selected.customerAccountId, "c");
  assert.equal(inspectionCustomerMatches(customers, "duplicate").length, 2);
});

test("stale IDs cannot link a different typed company, and missing addresses stay report-only", () => {
  const unrelated = inspectionCustomerIdentity({ customers, customerAccountId: "a", customerCompanyName: "New Carrier", customerAddress: "Unit 2\nOntario, CA 91761" });
  assert.equal(unrelated.customerAccountId, "");
  assert.equal(unrelated.customerCompanyName, "New Carrier");
  assert.equal(unrelated.customerAddress, "Unit 2\nOntario, CA 91761");
  const noAddress = inspectionCustomerIdentity({ customers, customerCompanyName: "No Address", customerAddress: "Typed report address" });
  assert.equal(noAddress.customerAccountId, "d");

  assert.equal(noAddress.customerAddress, "Typed report address");
});

test("suggestions include unit owner and directory names without duplicate labels", () => {
  assert.deepEqual(inspectionCustomerSuggestions(customers, "Carrier"), ["Carrier", "Duplicate", "No Address"]);
  assert.deepEqual(inspectionCustomerSuggestions([], "Unit Owner"), ["Unit Owner"]);
});

test("legacy empty company stays optional but an entered address requires a company", () => {
  assert.equal(inspectionCustomerValidation(inspectionCustomerIdentity()), "");
  assert.match(inspectionCustomerValidation(inspectionCustomerIdentity({ customerAddress: "Address only" })), /Enter a customer company/);
  assert.equal(inspectionCustomerValidation(inspectionCustomerIdentity({ customerCompanyName: "New Carrier", customerAddress: "Full business address" })), "");
  assert.match(inspectionCustomerValidation(inspectionCustomerIdentity({ customers, customerCompanyName: "Duplicate" })), /Choose the saved customer/);
});

test("manual address edits and explicit clearing override a saved prefill without changing identity", () => {
  const selection = { customers, customerCompanyName: "Carrier" };
  assert.equal(inspectionCustomerIdentity(selection).customerAddress, customers[0].address);
  const edited = inspectionCustomerIdentity({ ...selection, customerAddress: "Report address\nChino, CA 91710" });
  assert.equal(edited.customerAccountId, "a");
  assert.equal(edited.customerAddress, "Report address\nChino, CA 91710");
  assert.equal(inspectionCustomerIdentity({ ...selection, customerAddress: "" }).customerAddress, "");
  assert.equal(customers[0].address, "123 Main St\nChino, CA 91710");
});
