import assert from "node:assert/strict";
import test from "node:test";

import {
  customerDocumentAdjustmentsFromForm,
  customerEstimateActionPending,
  customerEstimateErrorMessage,
  customerEstimateSourceKey,
  isCurrentCustomerEstimateRequest,
  recoveredEstimateMatchesSavedDraft,
} from "./customer-estimate-state.js";

test("estimate action animates only for pending saves or document requests", () => {
  const draft = { id: "draft-1", status: "active" };
  for (const draftStatus of ["dirty", "saving"]) assert.equal(customerEstimateActionPending({ draft, draftStatus }), true);
  for (const draftStatus of ["saved", "error", "pristine"]) assert.equal(customerEstimateActionPending({ draft, draftStatus }), false);
  assert.equal(customerEstimateActionPending({ busy: true }), true);
  assert.equal(customerEstimateActionPending({ draft: { ...draft, status: "discarded" }, draftStatus: "dirty" }), false);
  assert.equal(customerEstimateActionPending({ draftStatus: "pristine" }), false);
});

test("legacy draft adjustments restore as an empty, editable adjustment set", () => {
  assert.deepEqual(customerDocumentAdjustmentsFromForm(undefined), { lineDiscounts: [], documentDiscount: null, overrideReasons: [] });
  assert.deepEqual(customerDocumentAdjustmentsFromForm({ documentDiscount: { kind: "percentage", value: "", reason: "" } }), {
    lineDiscounts: [], documentDiscount: { kind: "percentage", value: "", reason: "" }, overrideReasons: [],
  });
  assert.deepEqual(customerDocumentAdjustmentsFromForm({ documentDiscount: { kind: "fixed", value: "not-yet-valid", reason: "x" }, lineDiscounts: "bad" }), {
    lineDiscounts: [], documentDiscount: { kind: "fixed", value: "not-yet-valid", reason: "x" }, overrideReasons: [],
  });
});

test("estimate request identity changes for every server-relevant draft or discount change", () => {
  const base = { companyId: "company-1", locationId: "location-1", ready: true, draft: { id: "draft-1", version: 3 }, adjustments: { lineDiscounts: [], documentDiscount: null, overrideReasons: [] } };
  const original = customerEstimateSourceKey(base);
  assert.notEqual(customerEstimateSourceKey({ ...base, ready: false }), original);
  assert.notEqual(customerEstimateSourceKey({ ...base, draft: { ...base.draft, version: 4 } }), original);
  assert.notEqual(customerEstimateSourceKey({ ...base, draft: { ...base.draft, id: "draft-2" } }), original);
  assert.notEqual(customerEstimateSourceKey({ ...base, locationId: "location-2" }), original);
  assert.notEqual(customerEstimateSourceKey({ ...base, adjustments: { ...base.adjustments, documentDiscount: { kind: "fixed", value: "25", reason: "Goodwill" } } }), original);
  assert.equal(isCurrentCustomerEstimateRequest(original, original), true);
  assert.equal(isCurrentCustomerEstimateRequest(original, customerEstimateSourceKey({ ...base, ready: false })), false);
});

test("recovered estimates match the exact saved draft and canonical discount intent", () => {
  const draft = { id: "draft-1", version: 3 };
  const adjustments = { lineDiscounts: [], documentDiscount: { kind: "percentage", value: "10", reason: "Fleet   goodwill" }, overrideReasons: [] };
  const revision = { snapshot: { sourceEvidence: { kind: "draft", id: "draft-1", version: 3 }, discountEvidence: { documentDiscount: { kind: "percentage", value: "10", reason: "Fleet   goodwill" } } } };
  assert.equal(recoveredEstimateMatchesSavedDraft({ revision, draft, adjustments }), true);
  assert.equal(recoveredEstimateMatchesSavedDraft({ revision: { snapshot: { ...revision.snapshot, discountEvidence: { documentDiscount: { ...revision.snapshot.discountEvidence.documentDiscount, reason: "Fleet goodwill" } } } }, draft, adjustments }), false);
  assert.equal(recoveredEstimateMatchesSavedDraft({ revision: { snapshot: { ...revision.snapshot, sourceEvidence: { ...revision.snapshot.sourceEvidence, version: 4 } } }, draft, adjustments }), false);
  assert.equal(recoveredEstimateMatchesSavedDraft({ revision: { snapshot: { ...revision.snapshot, sourceEvidence: { ...revision.snapshot.sourceEvidence, id: "draft-2" } } }, draft, adjustments }), false);
  assert.equal(recoveredEstimateMatchesSavedDraft({ revision: { snapshot: { ...revision.snapshot, discountEvidence: { documentDiscount: null } } }, draft, adjustments }), false);
  assert.equal(recoveredEstimateMatchesSavedDraft({ revision: { snapshot: { sourceEvidence: { kind: "draft", id: "draft-1", version: 3 } } }, draft, adjustments: undefined }), true);
});

test("customer estimate errors expose the first schema message instead of raw JSON", () => {
  assert.equal(customerEstimateErrorMessage({ message: '[{"code":"custom","path":["adjustments"],"message":"Percentage cannot exceed 100."}]' }, "Fallback"), "Percentage cannot exceed 100.");
  assert.equal(customerEstimateErrorMessage({ message: "Draft is stale." }, "Fallback"), "Draft is stale.");
});
