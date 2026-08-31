import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  claimWorkorderPrintArchive,
  completeWorkorderPrintArchive,
} from "./workorder-print-archives.repo.js";

const migrationUrl = new URL("../migrations/092_workorder_print_archives.sql", import.meta.url);
const repositoryUrl = new URL("./workorder-print-archives.repo.js", import.meta.url);

test("print archive schema fixes tenant scope, actor idempotency, lineage, and immutable evidence", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /workorder_print_archive_actor_idempotency_key[\s\S]*unique \(company_id, created_by_user_id, idempotency_key\)/);
  assert.match(sql, /unique \(company_id, workorder_id, revision_number\)/);
  assert.match(sql, /foreign key \(company_id, workorder_id, location_id, predecessor_archive_id\)/);
  assert.match(sql, /artifact_kind = 'revised'[\s\S]*predecessor_archive_id is not null[\s\S]*btrim\(revision_reason\) <> ''/);
  assert.match(sql, /before update or delete on workorder_print_archives/);
  assert.match(sql, /if old\.status = 'ready'/);
  assert.match(sql, /attempt_number integer not null default 1/);
  assert.match(sql, /lease_token uuid not null default gen_random_uuid\(\)/);
  assert.match(sql, /lease_expires_at timestamptz not null/);
  assert.match(sql, /storage_key is server-internal and must never be returned by APIs/);
});

test("scoped reads derive company and location filters and public rows omit storage keys", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  assert.match(source, /company_id = any\(\$2::uuid\[\]\)/);
  assert.match(source, /location_id = any\(\$4::uuid\[\]\)/);
  assert.match(source, /location_id = any\(\$3::uuid\[\]\)/);
  assert.match(source, /\.\.\.\(internal \? \{ storageKey:[\s\S]*leaseToken:/);
  assert.match(source, /lease_expires_at <= now\(\) as lease_expired/);
  assert.match(source, /attempt_number = attempt_number \+ 1, lease_token = gen_random_uuid\(\)/);
  assert.match(source, /lease_token = \$4 and lease_expires_at > now\(\)/);
  assert.match(source, /latest\.id !== input\.predecessorArchiveId \|\| latest\.location_id !== input\.locationId \|\| latest\.status !== "ready"/);
});

function mockPool(responses) {
  const calls = [];
  const client = {
    async query(text, params) {
      calls.push({ text, params });
      const next = responses.shift();
      return typeof next === "function" ? next(text, params) : (next || { rows: [] });
    },
    release() {},
  };
  return { calls, pool: { connect: async () => client } };
}

test("only an expired matching pending request is reclaimed with a new fenced lease", async () => {
  const existing = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    company_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    workorder_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    created_by_user_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    request_sha256: "a".repeat(64),
    status: "pending",
    lease_expired: true,
    lease_token: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    attempt_number: 1,
  };
  const renewed = { ...existing, lease_expired: false, lease_token: "ffffffff-ffff-4fff-8fff-ffffffffffff", attempt_number: 2 };
  const { calls, pool } = mockPool([
    { rows: [] }, { rows: [] }, { rows: [existing] }, { rows: [renewed] }, { rows: [] },
  ]);
  const result = await claimWorkorderPrintArchive({
    companyId: existing.company_id,
    workorderId: existing.workorder_id,
    actorId: existing.created_by_user_id,
    idempotencyKey: "print-key-lease",
    requestSha256: existing.request_sha256,
    leaseSeconds: 120,
  }, { pool });
  assert.equal(result.created, true);
  assert.equal(result.archive.leaseToken, renewed.lease_token);
  assert.equal(result.archive.attemptNumber, 2);
  assert.match(calls[3].text, /attempt_number = attempt_number \+ 1/);
  assert.deepEqual(calls[3].params, [existing.company_id, existing.id, 120]);
});

test("an active matching lease replays as pending and is never concurrently reclaimed", async () => {
  const existing = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    request_sha256: "b".repeat(64),
    status: "pending",
    lease_expired: false,
    attempt_number: 1,
  };
  const { calls, pool } = mockPool([
    { rows: [] }, { rows: [] }, { rows: [existing] }, { rows: [] },
  ]);
  const result = await claimWorkorderPrintArchive({
    companyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    workorderId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    actorId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    idempotencyKey: "print-key-active",
    requestSha256: existing.request_sha256,
    leaseSeconds: 120,
  }, { pool });
  assert.equal(result.created, false);
  assert.equal(calls.some(({ text }) => /attempt_number = attempt_number \+ 1/.test(text)), false);
});

test("an expired lease cannot be reclaimed with a different request hash", async () => {
  const existing = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    request_sha256: "a".repeat(64),
    status: "pending",
    lease_expired: true,
  };
  const { calls, pool } = mockPool([
    { rows: [] }, { rows: [] }, { rows: [existing] }, { rows: [] },
  ]);
  await assert.rejects(
    claimWorkorderPrintArchive({
      companyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      workorderId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      actorId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      idempotencyKey: "print-key-mismatch",
      requestSha256: "b".repeat(64),
      leaseSeconds: 120,
    }, { pool }),
    (error) => error.code === "PRINT_IDEMPOTENCY_CONFLICT",
  );
  assert.equal(calls.some(({ text }) => /attempt_number = attempt_number \+ 1/.test(text)), false);
  assert.equal(calls.at(-1).text, "rollback");
});

test("finalization is fenced by actor, unexpired lease token, and pending status", async () => {
  let captured;
  await assert.rejects(
    completeWorkorderPrintArchive({
      companyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      archiveId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actorId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      leaseToken: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      storageKey: "company/file.pdf",
      pdfSha256: "c".repeat(64),
      pdfByteSize: 10,
    }, { query: async (text, params) => { captured = { text, params }; return { rows: [] }; } }),
    (error) => error.code === "PRINT_ARCHIVE_FINALIZE_CONFLICT",
  );
  assert.match(captured.text, /lease_token = \$4 and lease_expires_at > now\(\)/);
  assert.equal(captured.params[3], "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
});
