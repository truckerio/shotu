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
