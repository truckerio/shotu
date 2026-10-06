import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVAL_NOT_REQUIRED,
  REQUIRED_EXTERNAL_CUSTOMER,
  approvalClassificationForRequest,
  askForCustomerApproval,
  contactOptions,
  customerAccountOptions,
  customerDirectorySelectionState,
  customerSelectionPatch,
} from "./customer-contact-model.js";

test("the approval control defaults to a distinct informational classification", () => {
  assert.equal(approvalClassificationForRequest(false), APPROVAL_NOT_REQUIRED);
  assert.equal(approvalClassificationForRequest(true), REQUIRED_EXTERNAL_CUSTOMER);
  assert.equal(askForCustomerApproval(APPROVAL_NOT_REQUIRED), false);
  assert.equal(askForCustomerApproval(REQUIRED_EXTERNAL_CUSTOMER), true);
});

test("typed customer names expose an exact directory match for automatic identity linking", () => {
  const customers = [{ id: "customer-1", name: "Long Haul", contacts: [] }];
  assert.deepEqual(customerDirectorySelectionState({ customers, customerAccountId: "customer-1", customerCompanyName: "Long Haul" }), {
    kind: "selected", customer: customers[0],
  });
  assert.deepEqual(customerDirectorySelectionState({ customers, customerAccountId: "", customerCompanyName: " long haul " }), {
    kind: "available_match", customer: customers[0],
  });
  assert.deepEqual(customerDirectorySelectionState({ customers, customerAccountId: "", customerCompanyName: "New operator" }), {
    kind: "typed_unmatched", customer: null,
  });
});

test("customer selection uses stable account and contact identity while retaining display fallback", () => {
  const customers = [{ id: "customer-b", name: "Bravo", contacts: [{ id: "contact-2", name: "Jamie", email: "jamie@example.test" }] }, { id: "customer-a", name: "Alpha" }];
  assert.deepEqual(customerAccountOptions(customers).map((entry) => entry.id), ["customer-a", "customer-b"]);
  assert.deepEqual(contactOptions(customers[0]).map((entry) => entry.label), ["Jamie · jamie@example.test"]);
  assert.deepEqual(customerSelectionPatch({ customer: customers[0], contact: customers[0].contacts[0] }), {
    customerAccountId: "customer-b", customerContactId: "contact-2", customerAddress: "", customerContactName: "", customerContactEmail: "", customerCompanyName: "Bravo",
  });
  assert.deepEqual(customerSelectionPatch({ fallbackName: "Manual customer" }), {
    customerAccountId: "", customerContactId: "", customerAddress: "", customerContactName: "", customerContactEmail: "", customerCompanyName: "Manual customer",
  });
});
