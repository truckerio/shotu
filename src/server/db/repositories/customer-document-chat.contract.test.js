import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  staffCustomerDocumentChatMessageSchema,
  staffCustomerDocumentChatQuerySchema,
} from "../../modules/customer-documents/customer-document-chat.schemas.js";
import { appendStaffCustomerDocumentMessage } from "./customer-document-chat.repo.js";

const migration = readFileSync(new URL("../migrations/189_customer_document_customer_chat.sql", import.meta.url), "utf8");
const repository = readFileSync(new URL("./customer-document-chat.repo.js", import.meta.url), "utf8");
const documentsRepo = readFileSync(new URL("./customer-documents.repo.js", import.meta.url), "utf8");

test("staff customer chat accepts the canonical stored company identifier", () => {
  const companyId = "00000000-0000-0000-0000-000000000001";
  const entityId = "11111111-1111-4111-8111-111111111111";
  assert.equal(staffCustomerDocumentChatQuerySchema.safeParse({
    companyId, locationId: entityId, documentId: entityId, revisionId: entityId,
  }).success, true);
  assert.equal(staffCustomerDocumentChatMessageSchema.safeParse({
    companyId, locationId: entityId, workorderId: entityId, documentId: entityId,
    revisionId: entityId, body: "Please review.", idempotencyKey: "chat-message-001",
  }).success, true);
  assert.equal(staffCustomerDocumentChatQuerySchema.safeParse({
    companyId, locationId: "not-a-uuid", documentId: entityId, revisionId: entityId,
  }).success, false);
});

test("customer discussion extends the canonical chat with a safe audience and no attachment reuse", () => {
  assert.match(migration, /alter table chat_messages/i);
  assert.match(migration, /audience varchar\(16\).*default 'internal'/i);
  assert.match(migration, /audience in \('internal','customer'\)/i);
  assert.match(migration, /customer_chat/i);
  assert.match(migration, /chat_messages_customer_audience_scope_guard/i);
  assert.match(migration, /chat_message_attachments_customer_audience_guard/i);
  assert.match(migration, /Customer discussion attachments are not enabled/i);
  assert.match(migration, /sender_role in \('admin','office','mechanic'\)[\s\S]*customer_request_hash ~ '\^\[0-9a-f\]\{64\}\$'/i);
});

test("repository resolves the canonical grant capability before listing or appending customer messages", () => {
  assert.match(repository, /resolveCustomerDocumentGrant/);
  assert.match(repository, /capability: "customer_chat"/);
  assert.match(repository, /addChatMessage/);
  assert.match(repository, /listCustomerAudienceChatMessages/);
  assert.match(repository, /customerDocumentAccessGrantId/);
  assert.doesNotMatch(repository, /customer_document_customer_messages/);
});

test("grant resolution aliases the exact grant revision for customer chat scope", () => {
  assert.match(documentsRepo, /grant_row\.revision_id as grant_revision_id/);
  assert.match(documentsRepo, /revisionId: row\.grant_revision_id \|\| row\.revision_id/);
});

test("staff customer-chat idempotency persists the request hash and rejects changed content", async () => {
  let stored = null;
  const client = {
    async query(text, params = []) {
      const sql = text.replace(/\s+/g, " ").trim();
      if (["begin", "commit", "rollback"].includes(sql)) return { rows: [] };
      if (sql.startsWith("insert into chat_messages")) {
        if (stored) return { rows: [] };
        stored = {
          id: "message-1",
          workorder_id: params[0],
          sender_user_id: params[1],
          sender_role: params[2],
          message_type: params[3],
          body: params[4],
          dedupe_key: params[5],
          audience: params[6],
          customer_document_id: params[7],
          customer_document_revision_id: params[8],
          customer_sender_name: params[10],
          customer_request_hash: params[11],
          created_at: new Date("2026-10-03T00:00:00.000Z"),
        };
        return { rows: [stored] };
      }
      if (sql.includes("from chat_messages cm")) return { rows: [stored] };
      if (sql.startsWith("update operational_workorders")) return { rows: [] };
      assert.fail(`Unexpected query: ${sql}`);
    },
    release() {},
  };
  const dependencies = { pool: { connect: async () => client } };
  const base = {
    workorderId: "11111111-1111-4111-8111-111111111111",
    documentId: "22222222-2222-4222-8222-222222222222",
    revisionId: "33333333-3333-4333-8333-333333333333",
    actorId: "44444444-4444-4444-8444-444444444444",
    actorRole: "office",
    idempotencyKey: "staff-message-001",
    body: "Original customer update.",
    requestHash: "a".repeat(64),
  };

  const inserted = await appendStaffCustomerDocumentMessage(base, dependencies);
  assert.equal(inserted.replayed, false);
  assert.equal(stored.customer_request_hash, base.requestHash);

  const replay = await appendStaffCustomerDocumentMessage(base, dependencies);
  assert.equal(replay.replayed, true);

  await assert.rejects(
    appendStaffCustomerDocumentMessage({
      ...base,
      body: "Changed customer update.",
      requestHash: "b".repeat(64),
    }, dependencies),
    (error) => error.code === "CUSTOMER_DOCUMENT_CHAT_IDEMPOTENCY_CONFLICT",
  );
});
