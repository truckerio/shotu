import assert from "node:assert/strict";
import test from "node:test";
import { reconcileWorkorderEstimate } from "./customer-document-reconciliation.js";

const hash = "a".repeat(64);

test("reconciliation authorizes only an accepted Workorder-source Estimate with the exact actual pricing fingerprint", () => {
  const actualSource = { profileVersionId: "profile", taxProfileVersionId: "tax", sourceEvidence: { kind: "workorder", id: "workorder", version: 8, pricingFingerprint: hash } };
  const acceptedEstimate = { id: "revision", snapshot: { profileVersionId: "profile", taxProfileVersionId: "tax", sourceEvidence: { kind: "workorder", pricingFingerprint: hash } } };
  const result = reconcileWorkorderEstimate({ actualSource, acceptedEstimate });
  assert.equal(result.invoiceEligible, true);
  assert.equal(result.requiresRevisedEstimate, false);
  assert.match(result.reconciliationHash, /^[0-9a-f]{64}$/);
});

test("draft authorization or changed actual pricing requires a revised Estimate", () => {
  const actualSource = { profileVersionId: "profile", taxProfileVersionId: "tax", sourceEvidence: { kind: "workorder", id: "workorder", version: 9, pricingFingerprint: hash } };
  for (const sourceEvidence of [
    { kind: "draft", pricingFingerprint: hash },
    { kind: "workorder", pricingFingerprint: "b".repeat(64) },
  ]) {
    const result = reconcileWorkorderEstimate({ actualSource, acceptedEstimate: { id: "revision", snapshot: { profileVersionId: "profile", taxProfileVersionId: "tax", sourceEvidence } } });
    assert.equal(result.status, "revised_estimate_required");
    assert.equal(result.invoiceEligible, false);
  }
});

test("the accepted activation Estimate remains invoice-eligible when the commercial scope is unchanged", () => {
  const lines = [
    { id: "draft-part", type: "part", description: "Replace gasket", quantity: "2", unit: "ea", unitPrice: "15.00" },
    { id: "labor", type: "labor", description: "Shop labor", quantity: "1.5", unit: "hr", unitPrice: "120.00" },
  ];
  const actualSource = {
    profileVersionId: "profile", taxProfileVersionId: "tax", lines: [...lines].reverse().map((line) => ({ ...line, id: `actual-${line.id}` })),
    sourceEvidence: { kind: "workorder", id: "workorder", version: 1, pricingFingerprint: "b".repeat(64) },
  };
  const acceptedEstimate = {
    id: "revision", activationAuthorized: true,
    snapshot: { profileVersionId: "profile", taxProfileVersionId: "tax", lines, sourceEvidence: { kind: "draft", pricingFingerprint: hash } },
  };
  const result = reconcileWorkorderEstimate({ actualSource, acceptedEstimate });
  assert.equal(result.invoiceEligible, true);
  assert.equal(result.requiresRevisedEstimate, false);
  assert.equal(result.sourceMatchMode, "activation_commercial_scope");
});

test("an activation Estimate requires a revised Estimate when commercial scope changed", () => {
  const actualSource = {
    profileVersionId: "profile", taxProfileVersionId: "tax",
    lines: [{ type: "part", description: "Replace gasket", quantity: "3", unit: "ea", unitPrice: "15.00" }],
    sourceEvidence: { kind: "workorder", id: "workorder", version: 2, pricingFingerprint: "b".repeat(64) },
  };
  const acceptedEstimate = {
    id: "revision", activationAuthorized: true,
    snapshot: {
      profileVersionId: "profile", taxProfileVersionId: "tax",
      lines: [{ type: "part", description: "Replace gasket", quantity: "2", unit: "ea", unitPrice: "15.00" }],
      sourceEvidence: { kind: "draft", pricingFingerprint: hash },
    },
  };
  assert.equal(reconcileWorkorderEstimate({ actualSource, acceptedEstimate }).invoiceEligible, false);
});

test("commercial or tax profile changes require a newly accepted revised Estimate", () => {
  const actualSource = { profileVersionId: "profile-2", taxProfileVersionId: "tax-2", sourceEvidence: { kind: "workorder", id: "workorder", version: 10, pricingFingerprint: hash } };
  const acceptedEstimate = { id: "revision", snapshot: { profileVersionId: "profile-1", taxProfileVersionId: "tax-1", sourceEvidence: { kind: "workorder", pricingFingerprint: hash } } };
  assert.equal(reconcileWorkorderEstimate({ actualSource, acceptedEstimate }).invoiceEligible, false);
});

import { compareLatestIssuedEstimate } from "./customer-document-reconciliation.js";
import { buildCustomerDocumentProjection } from "./customer-document-projection.js";

function comparisonSource() {
  return {
    document: { type: "estimate", state: "draft_projection" },
    shop: { legalName: "Shop" }, customer: { name: "Customer" }, unit: { label: "G2026" },
    concern: "Fuel pump", repairDescription: "", terms: "Terms", authorizationText: "Authorize", warrantyText: "", footer: "",
    profileVersionId: "11111111-1111-4111-8111-111111111111", taxProfileVersionId: "22222222-2222-4222-8222-222222222222",
    templateVersion: "customer-document-v1", sourceEvidence: { kind: "workorder", id: "33333333-3333-4333-8333-333333333333", version: 2, pricingFingerprint: "a".repeat(64) }, discountEvidence: { documentDiscount: null },
    financial: { currency: "USD", basis: "estimated", lines: [
      { id: "labor", type: "labor", description: "LABOR HOURS", quantity: "3", unit: "hr", unitPrice: "100", priceBasis: "selling_price", taxCategory: "labor", taxTreatment: "out_of_scope", taxComponents: [], source: { kind: "workorder_labor", id: "labor" } },
      { id: "part", type: "part", description: "FUEL PUMP", quantity: "1", unit: "ea", unitPrice: "69.99", priceBasis: "selling_price", taxCategory: "part", taxTreatment: "out_of_scope", taxComponents: [], source: { kind: "workorder_serialized_usage", id: "part" } },
    ] },
  };
}

test("latest issued pending estimate stays current across operational versions and source IDs", () => {
  const source = comparisonSource(); const snapshot = buildCustomerDocumentProjection(source).projection;
  source.sourceEvidence.version = 15; source.sourceEvidence.pricingFingerprint = "b".repeat(64);
  source.financial.lines.reverse(); source.financial.lines[0].id = "replacement-source-id";
  const result = compareLatestIssuedEstimate({ sourceInput: source, latestEstimate: { id: "revision", snapshot, response: { status: "pending" } } });
  assert.equal(result.state, "current"); assert.equal(result.requiresUpdate, false);
});

test("latest issued empty G2026 snapshot detects priced labor and part without rewriting history", () => {
  const source = comparisonSource(); const snapshot = { ...buildCustomerDocumentProjection(source).projection, lines: [], totals: { total: "0.00" } };
  const result = compareLatestIssuedEstimate({ sourceInput: source, latestEstimate: { id: "revision", snapshot } });
  assert.equal(result.state, "changed"); assert.ok(result.changedFields.includes("lines"));
  assert.equal(snapshot.lines.length, 0); assert.equal(snapshot.totals.total, "0.00");
  const corrected = buildCustomerDocumentProjection(source).projection;
  assert.deepEqual(corrected.lines.map(({ type, quantity, unitPrice, total }) => ({ type, quantity, unitPrice, total })), [
    { type: "labor", quantity: "3", unitPrice: "100", total: "300.00" },
    { type: "part", quantity: "1", unitPrice: "69.99", total: "69.99" },
  ]);
  assert.equal(corrected.totals.total, "369.99");
});

test("latest issued discounts do not make an unchanged estimate appear stale", () => {
  const source = comparisonSource(); source.financial.documentDiscount = { kind: "percentage", value: "10", reason: "Courtesy" };
  source.discountEvidence.documentDiscount = source.financial.documentDiscount;
  source.financial.lines[0].lineDiscount = { kind: "percentage", value: "5", reason: "Labor courtesy" };
  const snapshot = buildCustomerDocumentProjection(source).projection;
  source.financial.documentDiscount = null; source.financial.lines[0].lineDiscount = null;
  assert.equal(compareLatestIssuedEstimate({ sourceInput: source, latestEstimate: { id: "revision", snapshot } }).state, "current");
});

test("customer-facing scope, tax, price, customer and terms changes require updating", () => {
  const baseline = comparisonSource(); const snapshot = buildCustomerDocumentProjection(baseline).projection;
  for (const mutate of [s => s.financial.lines[0].quantity = "4", s => s.financial.lines[1].unitPrice = "80", s => s.concern = "New repair", s => s.customer.name = "Other customer", s => s.terms = "New terms", s => { s.financial.lines[0].taxTreatment = "exclusive"; s.financial.lines[0].taxComponents = [{ name: "Tax", rate: "5", compound: false }]; }]) {
    const source = structuredClone(baseline); mutate(source);
    assert.equal(compareLatestIssuedEstimate({ sourceInput: source, latestEstimate: { id: "revision", snapshot } }).state, "changed");
  }
});


test("unchanged published profile IDs and issued recipient contact do not imply Workorder edits", () => {
  const source = comparisonSource(); const snapshot = buildCustomerDocumentProjection(source).projection;
  snapshot.customer = { ...snapshot.customer, company: "Customer", name: "Receiving Contact", email: "contact@example.test", phone: "555-0100" };
  source.profileVersionId = "44444444-4444-4444-8444-444444444444";
  source.taxProfileVersionId = "55555555-5555-4555-8555-555555555555";
  assert.equal(compareLatestIssuedEstimate({ sourceInput: source, latestEstimate: { id: "revision", snapshot } }).state, "current");
});


test("reducing prices below an issued fixed discount reports a change instead of failing summary", () => {
  const source = comparisonSource(); source.financial.lines[0].lineDiscount = { kind: "fixed", value: "250", reason: "Courtesy" };
  const snapshot = buildCustomerDocumentProjection(source).projection;
  source.financial.lines[0].lineDiscount = null; source.financial.lines[0].unitPrice = "10";
  assert.equal(compareLatestIssuedEstimate({ sourceInput: source, latestEstimate: { id: "revision", snapshot } }).state, "changed");
});
