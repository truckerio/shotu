import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  activateGlobalLayoutHmacVersion,
  transitionGlobalLayoutArtifact,
} from "../../db/repositories/invoice-global-layouts.repo.js";

const migrationUrl = new URL("../../db/migrations/085_invoice_global_layout_learning.sql", import.meta.url);
const repositoryUrl = new URL("../../db/repositories/invoice-global-layouts.repo.js", import.meta.url);

test("global layout migration separates tenant governance from backlink-free artifacts", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create table invoice_global_layout_consents/i);
  assert.match(sql, /create table invoice_global_layout_contributions/i);
  assert.match(sql, /create table invoice_global_layout_templates/i);
  assert.match(sql, /create table invoice_global_layout_rebuilds/i);
  assert.match(sql, /state in \('disabled', 'enabled', 'withdrawing'\)/i);
  assert.match(sql, /status in \('shadow', 'canary', 'active', 'quarantined', 'retired'\)/i);
  assert.match(sql, /hmac key lifecycle metadata only/i);
  const artifactBlock = sql.match(/create table invoice_global_layout_templates[\s\S]+?\n\);/i)?.[0] || "";
  assert.doesNotMatch(artifactBlock, /company_id|run_id|user_id|reviewer_id|vendor|raw_ocr|draft|source_document/i);
  assert.doesNotMatch(sql, /hmac_key\s+(?:text|varchar|bytea)/i);
});

test("global lookup has an artifact-only projection and parameterized marker overlap", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  const lookup = source.match(/export async function findActiveGlobalLayoutTemplates[\s\S]+?\n\}/)?.[0] || "";
  assert.match(lookup, /status = 'active'/i);
  assert.match(lookup, /marker_digests && \$3::char\(64\)\[\]/i);
  assert.doesNotMatch(lookup, /company_id|run_id|reviewer_id|vendor_key|sanitized_payload/i);
});

test("HMAC metadata rotation stores versions but never keys", async () => {
  const calls = [];
  const db = { query: async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    return { rows: sql.includes("returning key_version") ? [{ key_version: "v2", status: "active" }] : [] };
  } };
  assert.equal((await activateGlobalLayoutHmacVersion({ keyVersion: "v2" }, db)).status, "active");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.flatMap((call) => call.parameters), ["v2", "v2"]);
  assert.equal(calls.some((call) => /secret|key_bytes|key_material/i.test(call.sql)), false);
});

test("artifact lifecycle forbids direct activation and gates canary promotion in SQL", async () => {
  await assert.rejects(() => transitionGlobalLayoutArtifact({
    id: "global-1", expectedStatus: "shadow", nextStatus: "active",
  }, { query: async () => ({ rows: [] }) }), /invalid_global_layout_lifecycle_transition/);
  const statements = [];
  const transitioned = await transitionGlobalLayoutArtifact({
    id: "global-1", expectedStatus: "shadow", nextStatus: "canary", releaseEvidenceId: "evidence-1", reasonCode: "sealed_test",
  }, { query: async (sql) => {
    statements.push(sql);
    if (/select structural_fingerprint/i.test(sql)) return { rows: [{ structural_fingerprint: "a".repeat(64), schema_version: 1, hmac_key_version: "v1" }] };
    if (/update invoice_global_layout_templates template/i.test(sql)) return { rows: [{ id: "global-1", status: "canary" }] };
    return { rows: [] };
  } });
  assert.equal(transitioned.status, "canary");
  assert.match(statements.join("\n"), /eligible_count >= 300[\s\S]+negative_count[\s\S]+release_evaluator/i);
});
