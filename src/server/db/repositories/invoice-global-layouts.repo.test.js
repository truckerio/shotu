import assert from "node:assert/strict";
import test from "node:test";
import {
  claimGlobalLayoutContributionCommand,
  createGlobalLayoutArtifact,
  findActiveGlobalLayoutTemplates,
  insertGlobalLayoutContribution,
  retireGlobalLayoutHmacVersion,
} from "./invoice-global-layouts.repo.js";

test("artifact creation serializes behind HMAC retirement before taking its artifact lock", async () => {
  const calls = [];
  await createGlobalLayoutArtifact({
    structuralFingerprint: "a".repeat(64), schemaVersion: 1, hmacKeyVersion: "v1",
    markerDigests: ["b".repeat(64), "c".repeat(64), "d".repeat(64)],
    templatePayload: {}, status: "shadow", supportCount: 5, companyCount: 3,
    maxCompanyShare: 0.4, criticalExactMatch: 1, totalsReconcileRate: 1,
    falseMatchRate: 0, privacyScannerVersion: "global-layout-privacy-v1",
    privacyScanDigest: "e".repeat(64),
  }, {
    query: async (sql, parameters = []) => { calls.push({ sql, parameters }); return { rows: [{ id: "artifact-1" }] }; },
  });
  assert.match(calls[0].sql, /invoice-global-hmac-version/i);
  assert.deepEqual(calls[1].parameters, [`invoice-global-artifact:${"a".repeat(64)}:1:v1`]);
  assert.match(calls[2].sql, /hmac\.status in \('active', 'matching'\)/i);
});

test("accepted contribution atomically queues promotion/rebuild evaluation", async () => {
  const calls = [];
  const db = {
    query: async (sql, parameters = []) => {
      calls.push({ sql, parameters });
      if (/returning id, structural_fingerprint, schema_version, hmac_key_version, state/i.test(sql)) {
        return { rows: [{
          id: "contribution-1",
          structural_fingerprint: "a".repeat(64),
          schema_version: 1,
          hmac_key_version: "v1",
          state: "eligible",
        }] };
      }
      if (/insert into invoice_global_layout_rebuilds/i.test(sql)) {
        return { rows: [{ id: "rebuild-1", status: "queued" }] };
      }
      return { rows: [] };
    },
  };
  const result = await insertGlobalLayoutContribution({
    companyId: "company-1",
    runId: "run-1",
    reviewerId: "reviewer-1",
    structuralFingerprint: "a".repeat(64),
    schemaVersion: 1,
    hmacKeyVersion: "v1",
    sanitizedPayload: {},
    privacyScannerVersion: "global-layout-privacy-v1",
    privacyScanDigest: "b".repeat(64),
    replayEvidence: { positiveMatched: true },
    companyLayoutCap: 5,
  }, db);
  assert.equal(result.id, "contribution-1");
  assert.equal(calls.filter(({ sql }) => /insert into invoice_global_layout_rebuilds/i.test(sql)).length, 1);
  assert.deepEqual(calls.filter(({ sql }) => /pg_advisory_xact_lock/i.test(sql)).map(({ parameters }) => parameters[0]), [
    "invoice-global-withdraw:company-1",
    `invoice-global-artifact:${"a".repeat(64)}:1:v1`,
    `invoice-global-contribution:company-1:${"a".repeat(64)}`,
  ]);
});

test("active global lookup projects no tenant, run, reviewer, vendor, or contribution identity", async () => {
  let queryText = "";
  const rows = [{ id: "global-1", template_payload: { schemaVersion: 1 } }];
  const result = await findActiveGlobalLayoutTemplates({
    markerDigests: ["a".repeat(64)],
    schemaVersion: 1,
    hmacKeyVersion: "v1",
  }, {
    query: async (sql) => { queryText = sql; return { rows }; },
  });
  assert.deepEqual(result, rows);
  assert.doesNotMatch(queryText, /company_id|run_id|reviewer_id|vendor_key|contribution_id/i);
  assert.match(queryText, /status = 'active'/i);
  assert.match(queryText, /hmac\.status in \('active', 'matching'\)/i);
  assert.match(queryText, /evidence\.status = 'sealed'/i);
});

test("durable contribution claim is bound to the reviewed run, reviewer, request hash, and current consent", async () => {
  let queryText = "";
  await claimGlobalLayoutContributionCommand({
    query: async (sql) => { queryText = sql; return { rows: [] }; },
  });
  assert.match(queryText, /run\.status = 'reviewed'/i);
  assert.match(queryText, /run\.reviewed_by = command\.reviewer_id/i);
  assert.match(queryText, /run\.review_request_hash = command\.review_request_hash/i);
  assert.match(queryText, /consent\.state = 'enabled'/i);
  assert.match(queryText, /for update of command skip locked/i);
});

test("retiring an HMAC version synchronously quarantines dependents with their prior lifecycle state", async () => {
  const calls = [];
  const result = await retireGlobalLayoutHmacVersion({ keyVersion: "v1" }, {
    query: async (sql, parameters = []) => {
      calls.push({ sql, parameters });
      if (/update invoice_global_layout_hmac_versions/i.test(sql)) {
        return { rows: [{ key_version: "v1", status: "retired" }] };
      }
      return { rows: [] };
    },
  });
  assert.equal(result.status, "retired");
  assert.match(calls[0].sql, /invoice-global-hmac-version/i);
  const quarantine = calls.find(({ sql }) => /hmac_key_retired/i.test(sql))?.sql || "";
  assert.match(quarantine, /select id, status[\s\S]+for update/i);
  assert.match(quarantine, /selected\.status, 'quarantined'/i);
});
