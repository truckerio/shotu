import assert from "node:assert/strict";
import test from "node:test";
import {
  changeGlobalLayoutPolicy,
  contributeGlobalInvoiceLayout,
  evaluateGlobalLayoutPromotion,
  governGlobalLayoutRelease,
  readGlobalLayoutPolicy,
} from "./invoice-global-learning.service.js";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const context = { actor: { id: "22222222-2222-4222-8222-222222222222", role: "admin" }, companyIds: new Set([COMPANY]) };

test("company policy is default-off and restricted to an in-scope admin", async () => {
  assert.equal((await readGlobalLayoutPolicy(COMPANY, context, { getConsent: async () => null })).state, "disabled");
  await assert.rejects(() => readGlobalLayoutPolicy(COMPANY, { ...context, actor: { ...context.actor, role: "office" } }, {
    getConsent: async () => { throw new Error("must not query"); },
  }), /not available/);
});

test("withdrawal delegates synchronous tombstone/quarantine in the policy transaction", async () => {
  const calls = [];
  const result = await changeGlobalLayoutPolicy(COMPANY, {
    enabled: false, expectedVersion: 3, policyVersion: "global-v1", idempotencyKey: "withdraw-123",
  }, context, {
    transaction: async (operation) => operation({ query: async () => ({ rows: [] }) }),
    withdrawConsent: async (input) => {
      calls.push(["withdraw", input]);
      return { consent: { state: "withdrawing" }, rebuilds: [{ status: "queued" }] };
    },
    recordConsentEvent: async (input) => calls.push(["event", input]),
  });
  assert.equal(result.consent.state, "withdrawing");
  assert.deepEqual(calls.map(([name]) => name), ["event", "withdraw"]);
  assert.equal(calls[0][1].action, "withdrawal_requested");
});

test("policy idempotency replays without repeating lifecycle mutation", async () => {
  let mutations = 0;
  const replay = await changeGlobalLayoutPolicy(COMPANY, {
    enabled: true, expectedVersion: 1, policyVersion: "global-v1", idempotencyKey: "enable-12345",
  }, context, {
    transaction: async (operation) => operation({}),
    getConsentEvent: async () => ({ action: "enabled", policy_version: "global-v1" }),
    getConsent: async () => ({ state: "enabled", version: 2 }),
    enableConsent: async () => { mutations += 1; },
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.consent.state, "enabled");
  assert.equal(mutations, 0);
});

test("per-review confirmation and company consent are both required", async () => {
  assert.deepEqual(await contributeGlobalInvoiceLayout({ companyId: COMPANY, reviewerConfirmed: false }, context), { status: "not_requested" });
  assert.deepEqual(await contributeGlobalInvoiceLayout({ companyId: COMPANY, reviewerConfirmed: true }, context, {
    getConsent: async () => ({ state: "disabled" }),
  }), { status: "company_opt_out" });
  let inserted;
  const accepted = await contributeGlobalInvoiceLayout({
    companyId: COMPANY, reviewerConfirmed: true, runId: "run-1", reviewRequestHash: "b".repeat(64), keyring: {},
  }, context, {
    getConsent: async () => ({ state: "enabled" }),
    buildContribution: () => ({
      structuralFingerprint: "a".repeat(64), payload: { hmacKeyVersion: "v1" },
      privacyScan: { scannerVersion: "scanner-v1", scanDigest: "c".repeat(64) },
    }),
    replayEvidence: () => ({ evaluatorVersion: "replay-v1", positiveMatched: true }),
    activateHmacVersion: async ({ keyVersion }) => assert.equal(keyVersion, "v1"),
    enqueueContribution: async (input) => { inserted = input; return { id: "command-1", replayed: false }; },
  });
  assert.deepEqual(accepted, { status: "queued", replayed: false });
  assert.equal(inserted.companyId, COMPANY);
  assert.equal(inserted.reviewerId, context.actor.id);
  assert.equal(Object.hasOwn(inserted, "privacyScanPassed"), false);
});

test("replayed durable contribution reports terminal state instead of claiming it is queued", async () => {
  const result = await contributeGlobalInvoiceLayout({
    companyId: COMPANY, reviewerConfirmed: true, runId: "run-1",
    reviewRequestHash: "b".repeat(64), keyring: {},
  }, context, {
    getConsent: async () => ({ state: "enabled" }),
    buildContribution: () => ({
      structuralFingerprint: "a".repeat(64), payload: { hmacKeyVersion: "v1" },
      privacyScan: { scannerVersion: "scanner-v1", scanDigest: "c".repeat(64) },
    }),
    replayEvidence: () => ({}),
    activateHmacVersion: async () => {},
    enqueueContribution: async () => ({ id: "command-1", status: "failed", replayed: true }),
  });
  assert.deepEqual(result, { status: "failed", replayed: true });
});

test("unsupported global grammar remains optional and does not abort invoice review", async () => {
  let enqueued = 0;
  const result = await contributeGlobalInvoiceLayout({
    companyId: COMPANY, reviewerConfirmed: true, runId: "run-unsupported", keyring: {},
  }, context, {
    getConsent: async () => ({ state: "enabled" }),
    buildContribution: () => { throw new Error("invoice_global_layout_unsupported_grammar"); },
    enqueueContribution: async () => { enqueued += 1; },
  });
  assert.deepEqual(result, { status: "unsupported_grammar" });
  assert.equal(enqueued, 0);
});

test("promotion requires document diversity, accuracy, reconciliation, and low false match", () => {
  const companies = ["a", "a", "b", "b", "c"];
  const passing = companies.map((company_id) => ({
    company_id,
    replay_evidence: {
      positiveMatched: true, applicableCriticalFields: 10, correctCriticalFields: 10,
      totalsApplicable: true, totalsReconcile: true, explicitNegativeCount: 200, falsePositiveCount: 0,
    },
  }));
  assert.equal(evaluateGlobalLayoutPromotion(passing).eligible, true);
  const dominated = passing.map((item, index) => ({ ...item, company_id: index < 3 ? "a" : item.company_id }));
  assert.ok(evaluateGlobalLayoutPromotion(dominated).reasons.includes("company_dominance"));
  assert.ok(evaluateGlobalLayoutPromotion(passing.slice(0, 4)).reasons.includes("insufficient_documents"));
});

test("release lifecycle fails closed without independently verified sealed evidence", async () => {
  await assert.rejects(() => governGlobalLayoutRelease({ nextStatus: "canary" }), /unverified_release_evidence/);
  let transitionInput;
  const result = await governGlobalLayoutRelease({
    expectedStatus: "shadow", nextStatus: "canary", reasonCode: "sealed_test",
    evidence: { templateId: "template-1", sealedManifestHash: "a".repeat(64) },
  }, {
    verifySealedManifest: async () => true,
    transaction: async (operation) => operation({}),
    sealEvidence: async () => ({ id: "evidence-1" }),
    transitionArtifact: async (input) => { transitionInput = input; return { id: "template-1", status: "canary" }; },
  });
  assert.equal(result.artifact.status, "canary");
  assert.equal(transitionInput.releaseEvidenceId, "evidence-1");
});
