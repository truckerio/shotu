import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRole } from "../../auth/permissions.js";
import {
  readCustomerDocumentCustomerChat,
  readStaffCustomerDocumentChat,
  sendCustomerDocumentCustomerChat,
  sendStaffCustomerDocumentChat,
} from "./customer-document-chat.service.js";

const ids = {
  companyId: "11111111-1111-4111-8111-111111111111",
  locationId: "22222222-2222-4222-8222-222222222222",
  workorderId: "33333333-3333-4333-8333-333333333333",
  documentId: "44444444-4444-4444-8444-444444444444",
  revisionId: "55555555-5555-4555-8555-555555555555",
};
const token = "a".repeat(43);

function context(role = "office") {
  return {
    actor: { id: "66666666-6666-4666-8666-666666666666", role, displayName: "Shop Coordinator" },
    companyIds: new Set([ids.companyId]),
    locationIds: new Set([ids.locationId]),
    permissions: permissionsForRole(role),
  };
}

function grantScope() {
  return {
    grantId: "77777777-7777-4777-8777-777777777777",
    ...ids,
  };
}

test("customer chat requires the capability-scoped grant and returns only customer-audience rows", async () => {
  const result = await readCustomerDocumentCustomerChat(token, {
    read: async (received) => {
      assert.equal(received, token);
      return { messages: [{ id: "message", senderType: "staff", senderName: "Shop", body: "We found the issue." }] };
    },
  });
  assert.equal(result.messages.length, 1);
  await assert.rejects(
    () => readCustomerDocumentCustomerChat("bad", { read: async () => ({ messages: [] }) }),
    (error) => error.statusCode === 404 && error.code === "CUSTOMER_DOCUMENT_CHAT_UNAVAILABLE",
  );
});

test("customer message is append-only, idempotent, and its request hash excludes authorization decisions", async () => {
  let command;
  const result = await sendCustomerDocumentCustomerChat(token, {
    body: "Please confirm the revised labor.", customerName: "Pat Customer", idempotencyKey: "customer-chat-001",
  }, {
    append: async (received) => {
      command = received;
      return { message: { id: "message", body: received.body }, replayed: false };
    },
  });
  assert.equal(result.message.id, "message");
  assert.equal(command.rawToken, token);
  assert.match(command.requestHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(command).sort(), ["body", "customerName", "idempotencyKey", "rawToken", "requestHash"]);
});

test("staff messages require Workorder scope and never accept a client-supplied sender name", async () => {
  let command;
  const result = await sendStaffCustomerDocumentChat(context(), ids.workorderId, {
    ...ids,
    body: "We posted a revised estimate for your review.", idempotencyKey: "staff-customer-chat-001",
  }, {
    requireWorkorderAccess: async () => ({ companyId: ids.companyId, locationId: ids.locationId }),
    append: async (received) => { command = received; return { message: { id: "staff-message" }, replayed: false }; },
  });
  assert.equal(result.message.id, "staff-message");
  assert.equal(command.senderName, "Shop Coordinator");
  assert.equal(command.actorId, context().actor.id);
  assert.match(command.requestHash, /^[0-9a-f]{64}$/);
});

test("mechanics cannot send customer-visible messages without a published company messaging policy", async () => {
  let appended = false;
  await assert.rejects(
    () => sendStaffCustomerDocumentChat(context("mechanic"), ids.workorderId, {
      ...ids,
      body: "I found the issue.", idempotencyKey: "mechanic-customer-chat-001",
    }, {
      requireWorkorderAccess: async () => ({ companyId: ids.companyId, locationId: ids.locationId }),
      append: async () => { appended = true; },
    }),
    (error) => error.statusCode === 403 && error.code === "PERMISSION_DENIED",
  );
  assert.equal(appended, false);
});

test("office and admin can send customer-visible messages within their Workorder scope", async () => {
  for (const role of ["office", "admin"]) {
    const result = await sendStaffCustomerDocumentChat(context(role), ids.workorderId, {
      ...ids,
      body: "Your revised estimate is ready.", idempotencyKey: `${role}-customer-chat-001`,
    }, {
      requireWorkorderAccess: async () => ({ companyId: ids.companyId, locationId: ids.locationId }),
      append: async (received) => ({ message: { id: `${role}-message`, body: received.body }, replayed: false }),
    });
    assert.equal(result.message.id, `${role}-message`);
  }
});

test("staff reads use the same Workorder access boundary and mechanics can read only through assigned Workorder access", async () => {
  const result = await readStaffCustomerDocumentChat(context("mechanic"), ids.workorderId, {
    companyId: ids.companyId, locationId: ids.locationId, documentId: ids.documentId, revisionId: ids.revisionId,
  }, {
    requireWorkorderAccess: async () => ({ companyId: ids.companyId, locationId: ids.locationId }),
    list: async (scope) => {
      assert.equal(scope.actorId, context("mechanic").actor.id);
      return [];
    },
  });
  assert.deepEqual(result.messages, []);
});
