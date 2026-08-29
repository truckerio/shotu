import assert from "node:assert/strict";
import test from "node:test";
import {
  deterministicGlobalLayoutArtifact,
  drainGlobalLayoutRebuilds,
  rebuildGlobalLayout,
  runNextGlobalLayoutContribution,
  runNextGlobalLayoutRebuild,
} from "./invoice-global-learning.worker.js";
import { buildGlobalInvoiceLayoutContribution } from "./invoice-global-layout.js";

const keyring = { version: "v1", keys: { v1: Buffer.alloc(32, 7) } };
const built = buildGlobalInvoiceLayoutContribution({
  observation: { width: 1000, height: 1400, regions: [
    { text: "Invoice number", x: 600, y: 100, width: 100, height: 20 },
    { text: "INV-1", x: 760, y: 100, width: 100, height: 20 },
    { text: "Description", x: 300, y: 500, width: 140, height: 20 },
    { text: "Quantity", x: 650, y: 500, width: 100, height: 20 },
    { text: "Total", x: 700, y: 1000, width: 80, height: 20 },
    { text: "$10.00", x: 850, y: 1000, width: 80, height: 20 },
  ] },
  reviewedDraft: { invoiceNumber: { value: "INV-1" }, total: { value: 10 }, lines: [] },
  keyring,
});

const payload = {
  schemaVersion: 1, hmacKeyVersion: "v1", pageShape: "portrait",
  signatureRegions: [
    { markerHmac: "a".repeat(64), xBin: 1, yBin: 2 },
    { markerHmac: "b".repeat(64), xBin: 2, yBin: 3 },
    { markerHmac: "c".repeat(64), xBin: 3, yBin: 4 },
  ],
  fieldAnchors: [], tableColumns: [],
};

test("deterministic rebuild rejects inconsistent contribution bytes or fingerprints", async () => {
  const { globalLayoutFingerprint } = await import("./invoice-global-layout.js");
  const fingerprint = globalLayoutFingerprint(payload);
  const artifact = deterministicGlobalLayoutArtifact([{ sanitized_payload: payload, structural_fingerprint: fingerprint }]);
  assert.deepEqual(artifact.markerDigests, ["a".repeat(64), "b".repeat(64), "c".repeat(64)]);
  assert.throws(() => deterministicGlobalLayoutArtifact([{ sanitized_payload: payload, structural_fingerprint: "f".repeat(64) }]), /payload_mismatch/);
});

test("successful rebuild creates a new shadow artifact and never directly activates it", async () => {
  const fingerprint = built.structuralFingerprint;
  const contributions = ["a", "a", "b", "b", "c"].map((company_id) => ({
    company_id, sanitized_payload: built.payload, structural_fingerprint: fingerprint,
    privacy_scanner_version: built.privacyScan.scannerVersion,
    privacy_scan_digest: built.privacyScan.scanDigest,
    replay_evidence: {
      positiveMatched: true, applicableCriticalFields: 1, correctCriticalFields: 1,
      totalsApplicable: false, totalsReconcile: false, explicitNegativeCount: 0, falsePositiveCount: 0,
    },
  }));
  const calls = [];
  const result = await rebuildGlobalLayout({
    id: "rebuild-1", structural_fingerprint: fingerprint, schema_version: 1,
    hmac_key_version: "v1", attempts: 1,
  }, {
    transaction: async (operation) => operation({}),
    lockHmacLifecycle: async () => calls.push(["hmac-lock"]),
    lockArtifact: async () => calls.push(["lock"]),
    getRebuildForUpdate: async () => ({ status: "running" }),
    keyringForVersion: () => keyring,
    loadContributions: async () => contributions,
    markRebuild: async (input) => calls.push(["mark", input.status]),
    createArtifact: async (input) => { calls.push(["create", input.status]); return { id: "global-1", status: input.status }; },
    withdrawingCompanies: async () => [],
  });
  assert.equal(result.status, "shadow");
  assert.ok(result.releaseBlockedReasons.includes("unsealed_replay_evidence"));
  assert.deepEqual(calls, [["hmac-lock"], ["lock"], ["mark", "validating"], ["create", "shadow"], ["mark", "succeeded"]]);
});

test("rebuild withholds cross-tenant artifacts until company diversity is met", async () => {
  let created = 0;
  const result = await rebuildGlobalLayout({
    id: "rebuild-diversity", structural_fingerprint: built.structuralFingerprint, schema_version: 1,
    hmac_key_version: "v1", attempts: 1,
  }, {
    transaction: async (operation) => operation({}),
    lockHmacLifecycle: async () => {},
    lockArtifact: async () => {},
    getRebuildForUpdate: async () => ({ status: "running" }),
    keyringForVersion: () => keyring,
    loadContributions: async () => [{
      company_id: "only-company", sanitized_payload: built.payload,
      structural_fingerprint: built.structuralFingerprint,
      privacy_scanner_version: built.privacyScan.scannerVersion,
      privacy_scan_digest: built.privacyScan.scanDigest,
      replay_evidence: {
        positiveMatched: true, applicableCriticalFields: 1, correctCriticalFields: 1,
        totalsApplicable: true, totalsReconcile: true, explicitNegativeCount: 1000, falsePositiveCount: 0,
      },
    }],
    markRebuild: async () => {},
    createArtifact: async () => { created += 1; },
    retireArtifacts: async () => {},
    withdrawingCompanies: async () => [],
  });
  assert.equal(result.status, "withheld");
  assert.equal(created, 0);
});

test("rebuild rereads after the artifact lock and cannot recreate a fully withdrawn snapshot", async () => {
  const calls = [];
  const result = await rebuildGlobalLayout({
    id: "rebuild-1", structural_fingerprint: built.structuralFingerprint, schema_version: 1,
    hmac_key_version: "v1", attempts: 1,
  }, {
    transaction: async (operation) => operation({}),
    lockHmacLifecycle: async () => { calls.push("hmac-lock"); },
    lockArtifact: async () => calls.push("lock"),
    getRebuildForUpdate: async () => { calls.push("reread"); return { status: "running" }; },
    keyringForVersion: () => keyring,
    loadContributions: async () => { calls.push("load"); return []; },
    markRebuild: async (input) => calls.push(`mark:${input.status}`),
    createArtifact: async () => { throw new Error("revoked_snapshot_recreated"); },
    retireArtifacts: async () => calls.push("retire"),
    withdrawingCompanies: async () => ["company-1"],
    completeWithdrawal: async ({ companyId }) => calls.push(`complete:${companyId}`),
  });
  assert.equal(result.status, "retired");
  assert.deepEqual(calls, ["hmac-lock", "lock", "reread", "load", "mark:validating", "retire", "mark:succeeded", "complete:company-1"]);
});

test("failed rebuild records only a bounded safe error code", async () => {
  const marks = [];
  await assert.rejects(() => runNextGlobalLayoutRebuild({
    transaction: async (operation) => operation({}),
    claimRebuild: async () => ({ id: "r1", structural_fingerprint: "a".repeat(64), schema_version: 1, hmac_key_version: "v1" }),
    lockHmacLifecycle: async () => {},
    lockArtifact: async () => {},
    getRebuildForUpdate: async () => ({ status: "running" }),
    keyringForVersion: () => keyring,
    loadContributions: async () => { throw new Error("secret vendor payload: ACME"); },
    markRebuild: async (input) => marks.push(input),
  }), /secret vendor/);
  assert.equal(marks[0].errorCode, "global_layout_rebuild_failed");
});

test("drain stops at an empty queue and does not manufacture work", async () => {
  let claims = 0;
  const results = await drainGlobalLayoutRebuilds({
    maxJobs: 5,
    transaction: async (operation) => operation({}),
    claimContributionCommand: async () => null,
    claimRebuild: async () => { claims += 1; return null; },
  });
  assert.deepEqual(results, []);
  assert.equal(claims, 1);
});

test("durable command is independently rescanned before becoming a contribution", async () => {
  let inserted = 0;
  const result = await runNextGlobalLayoutContribution({
    transaction: async (operation) => operation({}),
    keyringForVersion: () => keyring,
    claimContributionCommand: async () => ({
      id: "command-1", company_id: "company-1", run_id: "run-1", reviewer_id: "reviewer-1",
      structural_fingerprint: built.structuralFingerprint, schema_version: 1, hmac_key_version: "v1",
      sanitized_payload: built.payload, privacy_scanner_version: built.privacyScan.scannerVersion,
      privacy_scan_digest: "f".repeat(64), replay_evidence: {}, company_layout_cap: 5,
    }),
    insertContribution: async () => { inserted += 1; },
    completeContributionCommand: async () => {},
  });
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "invoice_global_layout_privacy_scan_mismatch");
  assert.equal(inserted, 0);
});

test("temporary HMAC configuration gaps requeue durable commands with bounded retry", async () => {
  let completion;
  const result = await runNextGlobalLayoutContribution({
    transaction: async (operation) => operation({}),
    keyringForVersion: () => null,
    claimContributionCommand: async () => ({
      id: "command-retry", hmac_key_version: "v1", attempts: 1,
    }),
    completeContributionCommand: async (input) => { completion = input; },
  });
  assert.equal(result.status, "retry_scheduled");
  assert.equal(completion.status, "pending");
  assert.equal(completion.errorCode, "invoice_global_layout_hmac_unavailable");
});
