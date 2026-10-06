import assert from "node:assert/strict";
import test from "node:test";
import {
  customerDocumentPreviewSchema,
  customerDocumentProfileQuerySchema,
  issueCustomerDocumentSchema,
  publishCustomerDocumentProfileSchema,
} from "./customer-documents.schemas.js";

const id = (digit) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const base = { companyId: id("1"), locationId: id("2") };

test("Workorder previews require an exact expected version and Invoice previews require a Workorder", () => {
  assert.equal(customerDocumentPreviewSchema.safeParse({
    ...base, source: { kind: "workorder", id: id("3") }, adjustments: {},
  }).success, false);
  assert.equal(customerDocumentPreviewSchema.safeParse({
    ...base, documentType: "invoice", source: { kind: "draft", id: id("3"), expectedVersion: 1 }, adjustments: {},
  }).success, false);
});

test("revised Estimate issue requires original draft/document/predecessor lineage", () => {
  const input = {
    ...base,
    documentId: null,
    predecessorRevisionId: null,
    draftId: null,
    workorderId: id("3"),
    documentType: "estimate",
    source: { kind: "workorder", id: id("3"), expectedVersion: 4 },
    expectedFinancialFingerprint: "a".repeat(64),
    adjustments: {},
    recipient: { channel: "link" },
    idempotencyKey: "revised-estimate-001",
  };
  const result = issueCustomerDocumentSchema.safeParse(input);
  assert.equal(result.success, false);
  assert.match(result.error.issues[0].message, /exact original document/i);
});

test("Invoice issue requires exact reconciliation evidence and forbids draft lineage", () => {
  const input = {
    ...base,
    documentId: null,
    predecessorRevisionId: null,
    draftId: null,
    workorderId: id("3"),
    documentType: "invoice",
    source: { kind: "workorder", id: id("3"), expectedVersion: 4 },
    expectedFinancialFingerprint: "a".repeat(64),
    adjustments: {},
    recipient: { channel: "link" },
    idempotencyKey: "invoice-issue-001",
  };
  assert.equal(issueCustomerDocumentSchema.safeParse(input).success, false);
  assert.equal(issueCustomerDocumentSchema.safeParse({ ...input, expectedReconciliationHash: "b".repeat(64) }).success, true);
  assert.equal(issueCustomerDocumentSchema.safeParse({ ...input, draftId: id("4"), expectedReconciliationHash: "b".repeat(64) }).success, false);
  for (const channel of ["email", "sms", "print"]) {
    assert.equal(issueCustomerDocumentSchema.safeParse({ ...input, recipient: { channel }, expectedReconciliationHash: "b".repeat(64) }).success, false);
  }
});

test("commercial profile GET and publish accept the canonical legacy company ID only", () => {
  const legacyCompanyId = "00000000-0000-0000-0000-000000000001";
  assert.equal(customerDocumentProfileQuerySchema.safeParse({ companyId: legacyCompanyId }).success, true);
  assert.equal(customerDocumentProfileQuerySchema.safeParse({ companyId: "not-a-company" }).success, false);

  const published = publishCustomerDocumentProfileSchema.safeParse({
    companyId: legacyCompanyId,
    locationId: null,
    profileId: null,
    expectedVersion: 0,
    shopIdentity: { legalName: "Default Company" },
    documentTerms: {},
    authorizationText: "Authorize the repair.",
    discountPolicy: {},
    lineTaxPolicy: {
      labor: "exclusive", part: "exclusive", shop_supply: "exclusive", fee: "exclusive",
      core_charge: "exclusive", credit: "zero_rated",
    },
    defaultCurrency: "USD",
    taxProfileVersionId: id("3"),
    idempotencyKey: "profile-publish-001",
  });
  assert.equal(published.success, true);
  assert.equal(publishCustomerDocumentProfileSchema.safeParse({
    ...published.data,
    companyId: "00000000-0000-0000-0000-00000000000x",
  }).success, false);
});

test("all customer-document staff routes accept the canonical legacy company ID", () => {
  const legacyCompanyId = "00000000-0000-0000-0000-000000000001";
  assert.equal(customerDocumentPreviewSchema.safeParse({
    companyId: legacyCompanyId,
    locationId: base.locationId,
    source: { kind: "draft", id: id("3"), expectedVersion: 1 },
    adjustments: {},
  }).success, true);
});
