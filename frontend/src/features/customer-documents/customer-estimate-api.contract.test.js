import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./customer-estimate-api.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../create-workorder/CreateWorkorderPage.jsx", import.meta.url), "utf8");
const review = readFileSync(new URL("./CustomerDocumentReview.jsx", import.meta.url), "utf8");

test("Estimate commands use the saved draft source and no client-authoritative financial values", () => {
  assert.match(source, /source: \{ kind: "draft", id: draftId, expectedVersion \}/);
  assert.match(source, /expectedFinancialFingerprint: projection\.financialFingerprint/);
  assert.doesNotMatch(source, /totalAmount:|taxTotal:|unitPrice:/);
  assert.match(source, /\/api\/customer-documents\/previews/);
  assert.match(source, /\/api\/customer-documents\/revisions/);
});

test("customer grants are fragment-only and activation has only frozen schema fields", () => {
  assert.match(source, /#customerDocument=\$\{rawToken\}/);
  assert.doesNotMatch(source, /\?customerDocument|\?grant/);
  assert.match(source, /expectedDraftVersion, idempotencyKey/);
  assert.doesNotMatch(source, /mechanicUserIds/);
});

test("Create gates customer issuance on a current saved draft and refreshes exact revision state", () => {
  assert.match(page, /savedDraft\.status === "active"[\s\S]*workorderDraft\.status === "saved" && !workorderDraft\.hasUnsyncedChanges/);
  assert.match(page, /readCustomerRevision\(revisionId\)/);
  assert.match(page, /customerProjection\.response\?\.status === "accepted"/);
  assert.equal(page.includes("draftCustomerDocumentProjection"), false);
  assert.match(page, /issueAvailable=\{authorizationClassification === "required_external_customer"/);
});

test("exact revision refresh merges current response and eligibility for accepted Estimate activation", () => {
  assert.match(source, /response: revision\.response \|\| snapshot\.response, eligibility: revision\.eligibility \|\| snapshot\.eligibility/);
  assert.match(page, /customerProjection\?\.eligibility\?\.canActivate/);
  assert.match(page, /customerProjection\.eligibility\?\.canActivate/);
});

test("issue and grant retries keep stable keys, while a missing grant secret requires explicit recovery", () => {
  assert.match(page, /issueKeyRef\.current \|\|= customerDocumentCommandKey\("estimate-issue"\)/);
  assert.match(page, /grantKeyRef\.current \|\|= customerDocumentCommandKey\("estimate-grant"\)/);
  assert.match(page, /customerRevisionId \? null : await issueDraftEstimate/);
  assert.match(review, /Create replacement customer link/);
  assert.match(page, /prior link may be invalidated or revoked/);
});

test("saved draft recovery restores the current Estimate before preview or issue", () => {
  assert.match(source, /\/api\/customer-documents\/drafts\/\$\{encodeURIComponent\(draftId\)\}\/current-estimate\?\$\{params\}/);
  assert.match(page, /readCurrentDraftEstimate\(\{ companyId: customerDocumentCompanyId, locationId: form\.locationId, draftId: savedDraft\.id \}\)/);
  assert.match(page, /if \(error\?\.status === 404\) return false/);
  assert.match(page, /if \(!customerRevisionId && await recoverCurrentDraftEstimate\(\{ open: true \}\)\) return/);
  assert.match(page, /setGrantRecoveryRequired\(true\)/);
});

test("an already recovered Estimate can be reopened from the create page", () => {
  assert.match(page, /if \(customerRevisionId\) \{\s*setCustomerPreviewOpen\(true\);\s*return;\s*\}/);
  assert.doesNotMatch(page, /if \(customerRevisionId \|\| await recoverCurrentDraftEstimate/);
});
