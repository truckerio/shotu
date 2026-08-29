import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../db/migrations/061_invoice_extraction_learning.sql", import.meta.url);
const corpusMigrationUrl = new URL("../../db/migrations/062_invoice_training_corpus.sql", import.meta.url);
const reextractionAuditMigrationUrl = new URL("../../db/migrations/086_invoice_source_reextraction_audit.sql", import.meta.url);

test("invoice learning migration owns tenant identity, concurrency, memory governance, and lookup indexes", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create table invoice_extraction_runs/i);
  assert.match(sql, /foreign key \(company_id, location_id\) references locations\(company_id, id\)/i);
  assert.match(sql, /unique \(company_id, created_by, idempotency_key\)/i);
  assert.match(sql, /version integer not null default 1/i);
  assert.match(sql, /create table invoice_correction_events/i);
  assert.match(sql, /create table invoice_semantic_facts/i);
  assert.match(sql, /status in \('candidate', 'approved', 'rejected'\)/i);
  assert.match(sql, /create table invoice_extraction_playbooks/i);
  assert.match(sql, /where status = 'approved'/i);
  assert.match(sql, /where status = 'active'/i);
  assert.doesNotMatch(sql, /document_(data|bytes)|raw_document/i);
});

test("invoice corpus migration encrypts sources, versions gold labels, audits access, and supports retention", async () => {
  const sql = await readFile(corpusMigrationUrl, "utf8");
  assert.match(sql, /create table invoice_source_documents/i);
  assert.match(sql, /ciphertext bytea/i);
  assert.match(sql, /octet_length\(iv\) = 12/i);
  assert.match(sql, /octet_length\(auth_tag\) = 16/i);
  assert.match(sql, /create table invoice_training_examples/i);
  assert.match(sql, /unique \(company_id, run_id, label_version\)/i);
  assert.match(sql, /create table invoice_source_access_events/i);
  assert.match(sql, /invoice_source_documents_retention_idx/i);
  assert.doesNotMatch(sql, /data_url|base64_document/i);
});

test("layout template migration is tenant scoped, privacy bounded, and requires three approvals", async () => {
  const migrationUrl = new URL("../../db/migrations/063_invoice_layout_templates.sql", import.meta.url);
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create table invoice_layout_templates/i);
  assert.match(sql, /company_id uuid not null references companies/i);
  assert.match(sql, /template_payload::text/i);
  assert.match(sql, /evidence_count >= 3/i);
  assert.match(sql, /template_learn/i);
  assert.match(sql, /invoice_layout_templates_match_idx/i);
});

test("re-extraction source access has a dedicated durable audit action", async () => {
  const sql = await readFile(reextractionAuditMigrationUrl, "utf8");
  assert.match(sql, /drop constraint invoice_source_access_events_action_check/i);
  assert.match(sql, /add constraint invoice_source_access_events_action_check/i);
  assert.match(sql, /'view', 'training_export', 'retention_delete', 'reextract'/i);
});
