import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chatMessageDedupeKey, chatReceiptFromRow } from "../../db/repositories/chat.repo.js";
import { sendMessageSchema } from "../workorders/workorder.schemas.js";
import { canViewWorkorderChat } from "../workorders/workorder-detail.service.js";
import { acknowledgeChatReceiptsSchema } from "./chat-receipts.schemas.js";
import { acknowledgeChatReceipts } from "./chat-receipts.service.js";

const migrationUrl = new URL("../../db/migrations/028_chat_message_receipts.sql", import.meta.url);
const repositoryUrl = new URL("../../db/repositories/chat.repo.js", import.meta.url);
const mechanicRoutesUrl = new URL("../../routes/mechanic.routes.js", import.meta.url);
const officeRoutesUrl = new URL("../../routes/office.routes.js", import.meta.url);
const detailServiceUrl = new URL("../workorders/workorder-detail.service.js", import.meta.url);
const mechanicServiceUrl = new URL("../mechanic/mechanic.service.js", import.meta.url);
const officeServiceUrl = new URL("../office/office.service.js", import.meta.url);
const surveillanceServiceUrl = new URL("../surveillance/surveillance.service.js", import.meta.url);
const moduleAccessServiceUrl = new URL("../workorders/workorder-module-access.service.js", import.meta.url);

test("receipt migration owns normalized per-user state with integrity and lookup indexes", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create table if not exists chat_message_receipts/i);
  assert.match(sql, /primary key \(message_id, user_id\)/i);
  assert.match(sql, /message_id uuid not null references chat_messages\(id\) on delete cascade/i);
  assert.match(sql, /user_id uuid not null references user_profiles\(id\)/i);
  assert.match(sql, /read_at is null or read_at >= delivered_at/i);
  assert.match(sql, /chat_message_receipts_user_delivery_idx/i);
  assert.match(sql, /chat_message_receipts_user_unread_idx/i);
  assert.doesNotMatch(sql, /jsonb/i);
});

test("receipt input accepts only one target and supported delivery states", () => {
  assert.deepEqual(
    acknowledgeChatReceiptsSchema.parse({
      throughMessageId: "11111111-1111-4111-8111-111111111111",
      status: "read",
    }),
    {
      throughMessageId: "11111111-1111-4111-8111-111111111111",
      status: "read",
    },
  );
  assert.throws(() => acknowledgeChatReceiptsSchema.parse({
    throughMessageId: "message-from-browser",
    status: "seen",
    actorUserId: "browser-actor",
  }));
});

test("client message UUID creates sender-safe retry identity", () => {
  const clientMessageId = "22222222-2222-4222-8222-222222222222";
  assert.equal(
    sendMessageSchema.parse({ body: "Retry-safe", clientMessageId }).clientMessageId,
    clientMessageId,
  );
  assert.throws(() => sendMessageSchema.parse({ body: "Bad identity", clientMessageId: "local-counter-1" }));
  assert.equal(
    chatMessageDedupeKey("mechanic-1", clientMessageId),
    `client-message:mechanic-1:${clientMessageId}`,
  );
  assert.notEqual(
    chatMessageDedupeKey("mechanic-1", clientMessageId),
    chatMessageDedupeKey("office-1", clientMessageId),
  );
  assert.equal(chatMessageDedupeKey("mechanic-1", null), null);
});

test("message projection advances from sent to delivered to read", () => {
  const base = { sender_user_id: "mechanic-1", sender_role: "mechanic", message_type: "normal" };
  assert.deepEqual(chatReceiptFromRow(base, "mechanic-1"), {
    status: "sent",
    deliveredCount: 0,
    readCount: 0,
    deliveredAt: null,
    readAt: null,
  });
  assert.equal(chatReceiptFromRow({
    ...base,
    receipt_delivered_count: "1",
    receipt_delivered_at: "2026-07-28T08:00:00.000Z",
  }, "mechanic-1").status, "delivered");
  assert.deepEqual(chatReceiptFromRow({
    ...base,
    receipt_delivered_count: "3",
    receipt_read_count: "2",
    receipt_delivered_at: "2026-07-28T08:02:00.000Z",
    receipt_read_at: "2026-07-28T08:03:00.000Z",
  }, "mechanic-1"), {
    status: "read",
    deliveredCount: 3,
    readCount: 2,
    deliveredAt: "2026-07-28T08:02:00.000Z",
    readAt: "2026-07-28T08:03:00.000Z",
  });
});

test("system messages never expose receipt state", () => {
  assert.equal(chatReceiptFromRow(
    { sender_user_id: null, sender_role: "system", message_type: "system" },
    "mechanic-1",
  ), null);
});

test("receipt projection is visible only to the authenticated sender", () => {
  const row = {
    sender_user_id: "mechanic-1",
    sender_role: "mechanic",
    message_type: "normal",
    receipt_delivered_count: "2",
    receipt_read_count: "1",
  };
  assert.equal(chatReceiptFromRow(row, "mechanic-1").status, "read");
  assert.equal(chatReceiptFromRow(row, "office-1"), null);
  assert.equal(chatReceiptFromRow(row, null), null);
});

test("service uses authenticated actor and rejects a target outside the workorder", async () => {
  let received;
  const result = await acknowledgeChatReceipts({
    workorderId: "workorder-1",
    actorUserId: "actor-from-session",
    throughMessageId: "message-2",
    status: "delivered",
  }, {
    acknowledge: async (input) => {
      received = input;
      return { ...input, acknowledgedCount: 2 };
    },
  });
  assert.equal(received.actorUserId, "actor-from-session");
  assert.equal(result.acknowledgedCount, 2);

  await assert.rejects(
    acknowledgeChatReceipts({
      workorderId: "workorder-1",
      actorUserId: "actor-from-session",
      throughMessageId: "message-from-other-workorder",
      status: "read",
    }, { acknowledge: async () => null }),
    (error) => error.statusCode === 404 && error.code === "RESOURCE_NOT_FOUND",
  );
});

test("repository acknowledgement is idempotent, excludes self and system messages, and read implies delivery", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  assert.match(source, /on conflict \(message_id, user_id\) do update/i);
  assert.match(source, /least\(chat_message_receipts\.delivered_at, excluded\.delivered_at\)/i);
  assert.match(source, /coalesce\(chat_message_receipts\.read_at, excluded\.read_at\)/i);
  assert.match(source, /case when \$4 = 'read' then now\(\) else null end/i);
  assert.match(source, /sender_user_id is not null[\s\S]*sender_user_id <> \$3/i);
  assert.match(source, /select id, created_at[\s\S]*sender_role <> 'system'[\s\S]*message_type <> 'system'/i);
  assert.match(source, /join chat_messages boundary[\s\S]*boundary\.id = \$3[\s\S]*boundary\.workorder_id = \$1/i);
  assert.match(source, /\(cm\.created_at, cm\.id\) <= \(boundary\.created_at, boundary\.id\)[\s\S]*cm\.sender_user_id is not null/i);
  assert.match(source, /cm\.sender_user_id is distinct from \$2/i);
  assert.match(source, /cm\.sender_role <> 'system'/i);
  assert.match(source, /cm\.message_type <> 'system'/i);
  assert.match(source, /cm\.workorder_id = \$1[\s\S]*\(cm\.created_at, cm\.id\) <= \(boundary\.created_at, boundary\.id\)/i);
  assert.match(source, /\[workorderId, actorUserId, target\.rows\[0\]\.id, status\]/i);
  assert.doesNotMatch(source, /\[workorderId, actorUserId, target\.rows\[0\]\.created_at/);
  assert.match(source, /where id = \$1[\s\S]*and workorder_id = \$2/i);
});

test("chat insert returns the committed message on client retry without repeating side effects", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  assert.match(source, /on conflict \(workorder_id, dedupe_key\) where dedupe_key is not null do nothing/i);
  assert.match(source, /if \(!message\.rows\[0\]\)/i);
  assert.match(source, /cm\.dedupe_key = \$2[\s\S]*cm\.sender_user_id = \$3/i);
  assert.match(source, /deduplicated: true/i);
  const duplicateBranch = source.match(/if \(!message\.rows\[0\]\) \{[\s\S]*?deduplicated: true,[\s\S]*?}/)?.[0] || "";
  assert.doesNotMatch(duplicateBranch, /update operational_workorders|workorder_status_events/);
});

test("shared list projection aggregates multiple recipients without legacy read_by", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  assert.match(source, /count\(\*\) as delivered_count/i);
  assert.match(source, /count\(\*\) filter \(where cmr\.read_at is not null\) as read_count/i);
  assert.match(source, /min\(cmr\.delivered_at\) as delivered_at/i);
  assert.match(source, /min\(cmr\.read_at\) as read_at/i);
  assert.match(source, /group by cmr\.message_id/i);
  assert.doesNotMatch(source, /join lateral/i);
  assert.match(source, /receipt_message\.sender_user_id = \$2/i);
  assert.doesNotMatch(source, /cm\.read_by|read_by\s*=/i);
});

test("mechanic and office receipt routes require resource-scoped chat acknowledgement access", async () => {
  for (const routeUrl of [mechanicRoutesUrl, officeRoutesUrl]) {
    const source = await readFile(routeUrl, "utf8");
    assert.match(source, /workorderIdFrom\(url\.pathname, "\/message-receipts"\)/);
    assert.match(
      source,
      /runAction\(requestContext, receiptWorkorderId, "chat", "acknowledge", input\)/,
    );
    assert.doesNotMatch(source, /actorUserId:\s*input\./);
  }
  const mechanicSource = await readFile(mechanicRoutesUrl, "utf8");
  const receiptBlock = mechanicSource.match(
    /const receiptWorkorderId[\s\S]*?if \(req\.method === "POST" && receiptWorkorderId\) \{[\s\S]*?return true;\s*}/,
  )?.[0] || "";
  assert.doesNotMatch(receiptBlock, /allowAvailable|allowActiveAtLocation/);

  const moduleAccessSource = await readFile(moduleAccessServiceUrl, "utf8");
  assert.match(
    moduleAccessSource,
    /const workorder = await requireAccess\(context, workorderId, resourceAccess\);[\s\S]*const policies = await getEffectivePolicy/,
  );
});

test("detail services pass viewer identity only for authenticated mechanic and office senders", async () => {
  const [detail, mechanic, office, surveillance] = await Promise.all([
    readFile(detailServiceUrl, "utf8"),
    readFile(mechanicServiceUrl, "utf8"),
    readFile(officeServiceUrl, "utf8"),
    readFile(surveillanceServiceUrl, "utf8"),
  ]);
  assert.match(detail, /includeChat \? listChatMessages\(workorderId, \{ viewerUserId \}\) : \[\]/);
  assert.match(mechanic, /viewerUserId: mechanic\.id,[\s\S]*participantChatOnly: true/);
  assert.match(office, /loadWorkorderDetail\(workorderId, \{ viewerUserId: user\.id \}\)/);
  assert.match(surveillance, /listChatMessages\(workorderId\)/);
  assert.doesNotMatch(surveillance, /listChatMessages\(workorderId,\s*\{\s*viewerUserId/);
});

test("unassigned mechanic detail keeps summary access but suppresses chat payload", () => {
  const workorder = { mechanicIds: ["mechanic-1", "mechanic-2"] };
  assert.equal(canViewWorkorderChat(workorder, {
    viewerUserId: "mechanic-1",
    participantChatOnly: true,
  }), true);
  assert.equal(canViewWorkorderChat(workorder, {
    viewerUserId: "mechanic-3",
    participantChatOnly: true,
  }), false);
  assert.equal(canViewWorkorderChat(workorder, {
    viewerUserId: "office-1",
    participantChatOnly: false,
  }), true);
});

test("message list ordering is deterministic for equal timestamps", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  assert.match(source, /order by cm\.created_at asc, cm\.id asc/i);
});
