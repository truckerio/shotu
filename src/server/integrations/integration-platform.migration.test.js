import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../db/migrations/038_integration_platform.sql", import.meta.url);
const serverUrl = new URL("../../../server.js", import.meta.url);
const odooRepoUrl = new URL("./odoo/odoo.repo.js", import.meta.url);

test("integration platform migration defines company-scoped security and delivery primitives", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of [
    "integration_clients",
    "integration_credentials",
    "integration_jobs",
    "integration_job_attempts",
    "integration_mappings",
    "integration_idempotency_records",
    "integration_webhook_inbox",
    "integration_outbox_events",
    "integration_audit_events",
  ]) {
    assert.match(sql, new RegExp(`create table if not exists ${table}`));
  }
  assert.match(sql, /token_hash text not null/i);
  assert.doesNotMatch(sql, /integration_clients[\\s\\S]*raw_token/i);
  assert.match(sql, /integration_jobs_claim_idx/i);
  assert.match(sql, /integration_mappings_external_uidx/i);
  assert.match(sql, /integration_idempotency_client_key_uidx/i);
});

test("service integration authentication happens before same-origin bypass", async () => {
  const source = await readFile(serverUrl, "utf8");
  const serviceIndex = source.indexOf("if (isServiceIntegrationPath(url.pathname))");
  const resolveIndex = source.indexOf("resolveIntegrationRequestContext(req)", serviceIndex);
  const sameOriginIndex = source.indexOf("assertSameOriginMutation(req", serviceIndex);
  assert.ok(serviceIndex > -1);
  assert.ok(resolveIndex > serviceIndex);
  assert.ok(sameOriginIndex > resolveIndex);
});

test("Odoo result records lifecycle, attention, mapping, audit, outbox, and idempotency atomically", async () => {
  const source = await readFile(odooRepoUrl, "utf8");
  const body = source.slice(source.indexOf("export async function recordOdooResultAtomic"));
  assert.match(body, /await client\.query\("begin"\)/);
  assert.match(body, /integration_idempotency_records/);
  assert.match(body, /for update/);
  assert.match(body, /odoo_entry_status/);
  assert.match(body, /operational_workorders/);
  assert.match(body, /workorder_attention_state/);
  assert.match(body, /upsertIntegrationMapping/);
  assert.match(body, /appendIntegrationAudit/);
  assert.match(body, /appendOutboxEvent/);
  assert.match(body, /await client\.query\("commit"\)/);
  assert.match(body, /await client\.query\("rollback"\)/);
});
