import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { amendLegacyManualPartEvidenceSchema } from "./workorder.schemas.js";
import { applyManualPartEvidence } from "../../db/repositories/workorder-manual-part-evidence.repo.js";

test("new manual actual parts fail closed while legacy missing-UOM rows round-trip", async () => {
  const repository = await readFile(new URL("../../db/repositories/operational-workorders.repo.js", import.meta.url), "utf8");
  assert.match(repository, /WORKORDER_COUNTABLE_PART_REQUIRES_SERIAL/);
  assert.match(repository, /WORKORDER_MEASURED_PART_REQUIRES_AGGREGATE_USAGE/);
  assert.match(repository, /WORKORDER_LEGACY_PART_EVIDENCE_IMMUTABLE/);
  assert.match(repository, /uomCode: String\(part\?\.uomCode \|\| DEFAULT_UOM_CODE\)/);
  assert.match(repository, /evidenceId: match\.part\.evidenceId \|\| randomUUID\(\)/);
  assert.doesNotMatch(repository, /evidenceId:[^\n]*serial/i);
});

test("manual evidence migration backfills stable identity and immutable original hashes", async () => {
  const sql = await readFile(new URL("../../db/migrations/095_workorder_manual_part_evidence.sql", import.meta.url), "utf8");
  assert.match(sql, /jsonb_set\([\s\S]*'\{evidenceId\}'[\s\S]*gen_random_uuid\(\)/i);
  assert.match(sql, /'\{uomCode\}'[\s\S]*'pc'/i);
  assert.match(sql, /create table workorder_manual_part_evidence/i);
  assert.match(sql, /encode\(digest\(part\.value::text, 'sha256'\), 'hex'\)/i);
  assert.match(sql, /create table workorder_manual_part_amendments/i);
  assert.match(sql, /supersedes_amendment_id/i);
  assert.match(sql, /actor_id uuid not null references user_profiles\(id\)/i);
  assert.doesNotMatch(sql, /inventory_items|inventory_stock_movements|inventory_serialized_units/i);
});

test("manual amendment command is strict and action-shaped", () => {
  const corrected = amendLegacyManualPartEvidenceSchema.parse({
    operation: "legacyManualPartAmendment",
    evidenceId: "00000000-0000-4000-8000-000000000011",
    action: "corrected",
    replacementPart: { partNo: "FILTER", qty: "2", uomCode: "pc", repairOrder: "Replace" },
    reason: "Corrected verified quantity",
    idempotencyKey: "manual-evidence-correction-1",
  });
  assert.equal(corrected.replacementPart.qty, "2");
  assert.throws(() => amendLegacyManualPartEvidenceSchema.parse({
    ...corrected,
    action: "voided",
  }), /void amendment/i);
  assert.throws(() => amendLegacyManualPartEvidenceSchema.parse({
    operation: "legacyManualPartAmendment",
    evidenceId: corrected.evidenceId,
    action: "corrected",
    reason: "Missing replacement",
    idempotencyKey: "manual-evidence-correction-2",
  }), /corrected part value/i);
  assert.throws(() => amendLegacyManualPartEvidenceSchema.parse({
    ...corrected,
    replacementPart: { ...corrected.replacementPart, qty: "" },
  }), /quantity is required/i);
  assert.throws(() => amendLegacyManualPartEvidenceSchema.parse({ ...corrected, unexpected: true }));
});

test("manual amendments are tenant/location scoped, idempotent, and append-only", async () => {
  const source = await readFile(new URL("../../db/repositories/workorder-manual-part-evidence.repo.js", import.meta.url), "utf8");
  assert.match(source, /evidence\.company_id=any\(\$3::uuid\[\]\)/i);
  assert.match(source, /workorder\.location_id=any\(\$4::uuid\[\]\)/i);
  assert.match(source, /for update of evidence, workorder/i);
  assert.match(source, /AMENDABLE_STATUSES/);
  assert.match(source, /insert into workorder_manual_part_amendments/i);
  assert.match(source, /supersedes_amendment_id/i);
  assert.match(source, /original_hash/i);
  assert.match(source, /pg_advisory_xact_lock/i);
  assert.match(source, /select id, request_hash, original_hash, supersedes_amendment_id, created_at/i);
  assert.doesNotMatch(source, /update workorder_manual_part_evidence|delete from workorder_manual_part/i);
  assert.doesNotMatch(source, /inventory_items|inventory_stock_movements|inventory_serialized_units/i);
});

test("standard Parts save validates the effective projection and persists immutable raw evidence", async () => {
  const source = await readFile(new URL("../../db/repositories/operational-workorders.repo.js", import.meta.url), "utf8");
  assert.match(source, /listLockedWorkorderManualPartEvidence\(client,/);
  assert.match(source, /effectivePriorParts = applyManualPartEvidence\(priorParts, manualEvidence\)/);
  assert.match(source, /remainingPrior = effectivePriorParts\.map/);
  assert.match(source, /persistedParts = manualEvidence\.length \? priorParts : validatedParts/);
});

test("latest manual amendments replace or void legacy rows without mutating original evidence", () => {
  const original = { evidenceId: "00000000-0000-4000-8000-000000000011", partNo: "OLD", qty: "1", uomCode: "pc", repairOrder: "Old" };
  const corrected = applyManualPartEvidence([original, { partNo: "KEEP", qty: "1", uomCode: "pc" }], [{
    evidenceId: original.evidenceId,
    sourceOrdinal: 0,
    effectivePart: { partNo: "NEW", qty: "2", uomCode: "pc", repairOrder: "Corrected" },
  }]);
  assert.deepEqual(corrected, [
    { evidenceId: original.evidenceId, partNo: "NEW", qty: "2", uomCode: "pc", repairOrder: "Corrected" },
    { partNo: "KEEP", qty: "1", uomCode: "pc" },
  ]);
  assert.deepEqual(applyManualPartEvidence([original], [{ evidenceId: original.evidenceId, sourceOrdinal: 0, effectivePart: null }]), []);
  assert.equal(original.partNo, "OLD");
});
