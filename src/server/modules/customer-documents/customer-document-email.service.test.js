import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { permissionsForRole } from "../../auth/permissions.js";
import { emailCustomerDocumentLink } from "./customer-document-email.service.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const grantId = "33333333-3333-4333-8333-333333333333";
const deliveryId = "44444444-4444-4444-8444-444444444444";
const actorId = "55555555-5555-4555-8555-555555555555";
const token = "a".repeat(43);

function fakeDatabase({ failTerminalEvent = false, replayRequested = false } = {}) {
  const state = { status: null, events: [] };
  let saved;
  const client = {
    async query(sql, params) {
      if (sql === "begin") { saved = structuredClone(state); return { rows: [] }; }
      if (sql === "commit") { saved = null; return { rows: [] }; }
      if (sql === "rollback") {
        if (saved) { state.status = saved.status; state.events = saved.events; }
        saved = null;
        return { rows: [] };
      }
      if (sql.includes("pg_advisory_lock") || sql.includes("pg_advisory_unlock")) return { rows: [] };
      if (sql.includes("from customer_document_access_grants grant_row")) {
        return { rows: [{ company_id: companyId, location_id: locationId,
          document_id: grantId, revision_id: grantId,
          document_number: "EST-1", expires_at: new Date(Date.now() + 60_000),
          recipient_snapshot: { email: "sam@example.com" } }] };
      }
      if (sql.includes("insert into customer_document_email_deliveries")) {
        if (replayRequested) return { rows: [] };
        state.status = "requested";
        return { rows: [{ id: deliveryId, status: "requested", request_hash: params.at(-1) }] };
      }
      if (sql.includes("from customer_document_email_deliveries")) {
        return { rows: [{ id: deliveryId, status: "requested", request_hash: state.requestHash }] };
      }
      if (sql.includes("insert into customer_document_email_delivery_events")) {
        if (failTerminalEvent && params[2] !== undefined) throw new Error("event storage unavailable");
        state.events.push(params[2] || "requested");
        return { rows: [] };
      }
      if (sql.includes("update customer_document_email_deliveries")) {
        state.status = params[2];
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };
  if (replayRequested) {
    state.status = "requested";
    state.requestHash = createHash("sha256").update(JSON.stringify({
      companyId, locationId, grantId, tokenHash: createHash("sha256").update(token).digest("hex"),
      recipientEmail: "sam@example.com", actorId, idempotencyKey: command.idempotencyKey,
    })).digest("hex");
  }
  return { state, pool: { connect: async () => client } };
}

const context = {
  actor: { id: actorId, role: "office" },
  companyIds: new Set([companyId]), locationIds: new Set([locationId]),
  permissions: permissionsForRole("office"),
};
const command = { companyId, locationId, rawToken: token, idempotencyKey: "email-test-1" };

test("SMTP result requires explicit accepted recipient; normalized address is accepted", async () => {
  for (const [mailResult, expected] of [
    [undefined, "failed"], [{}, "failed"], [{ accepted: [] }, "failed"],
    [{ accepted: [" SAM@EXAMPLE.COM "] }, "provider_accepted"],
  ]) {
    const db = fakeDatabase();
    const result = await emailCustomerDocumentLink(context, grantId, command, {
      pool: db.pool, baseURL: "https://shop.example.com",
      mailer: { enabled: true, send: async () => mailResult },
    });
    assert.equal(result.status, expected);
    assert.equal(result.providerAccepted, expected === "provider_accepted");
    assert.deepEqual(db.state.events, ["requested", expected]);
  }
});

test("failed terminal event insert rolls back terminal status", async () => {
  const db = fakeDatabase({ failTerminalEvent: true });
  await assert.rejects(emailCustomerDocumentLink(context, grantId, command, {
    pool: db.pool, baseURL: "https://shop.example.com",
    mailer: { enabled: true, send: async () => ({ accepted: ["sam@example.com"] }) },
  }), /event storage unavailable/);
  assert.equal(db.state.status, "requested");
  assert.deepEqual(db.state.events, ["requested"]);
});

test("a requested replay resumes provider delivery under the same idempotency key", async () => {
  const db = fakeDatabase({ replayRequested: true });
  let sends = 0;
  const result = await emailCustomerDocumentLink(context, grantId, command, {
    pool: db.pool, baseURL: "https://shop.example.com",
    mailer: { enabled: true, send: async () => { sends += 1; return { accepted: ["sam@example.com"] }; } },
  });
  assert.equal(sends, 1);
  assert.equal(result.replayed, true);
  assert.equal(result.status, "provider_accepted");
});
