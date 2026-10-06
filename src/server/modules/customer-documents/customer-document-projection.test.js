import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomerDocumentProjection } from "./customer-document-projection.js";

function input() {
  return {
    document: { type: "estimate", state: "draft_projection" },
    shop: { legalName: "Example Repair" },
    customer: { name: "Customer", company: "Customer Co" },
    unit: { id: "unit-1", label: "Truck 12", make: "Freightliner", model: "Cascadia", year: 2020 },
    concern: "No start",
    repairDescription: "Diagnose starting system",
    terms: "Estimate expires after review.",
    authorizationText: "I authorize the work shown.",
    warrantyText: "",
    footer: "Thank you",
    profileVersionId: "11111111-1111-4111-8111-111111111111",
    templateVersion: "customer-document-v1",
    taxProfileVersionId: "22222222-2222-4222-8222-222222222222",
    sourceEvidence: {
      kind: "draft", id: "33333333-3333-4333-8333-333333333333", version: 1,
      pricingFingerprint: "a".repeat(64),
    },
    discountEvidence: { documentDiscount: null },
    financial: {
      currency: "USD",
      basis: "estimated",
      lines: [{
        id: "labor-1", type: "labor", description: "Diagnosis", quantity: "1", unit: "hr", unitPrice: "100",
        priceBasis: "selling_price", taxCategory: "labor", taxTreatment: "exempt", taxComponents: [],
        discountEligible: true, source: { kind: "labor_snapshot", id: "source-1" },
      }],
    },
  };
}

test("projection is a strict customer allowlist and hashes its exact immutable content", () => {
  const raw = input();
  raw.internalCost = "1";
  assert.throws(() => buildCustomerDocumentProjection(raw), /unrecognized/i);
  delete raw.internalCost;
  const first = buildCustomerDocumentProjection(raw);
  const second = buildCustomerDocumentProjection({ ...raw, shop: { ...raw.shop } });
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.projection.totals.total, "100.00");
  const serialized = JSON.stringify(first.projection);
  for (const forbidden of ["internalCost", "batchCost", "margin", "supplier", "inventoryPosition"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("projection rejects protected or client-invented line fields", () => {
  const raw = input();
  raw.financial.lines[0].batchCost = "1";
  assert.throws(() => buildCustomerDocumentProjection(raw), /unrecognized/i);
});
