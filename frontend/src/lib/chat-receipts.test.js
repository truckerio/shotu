import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_RECEIPT_STATUS,
  canReadChat,
  createChatReceiptAckTracker,
  latestIncomingChatMessage,
  receiptDisplayStatus,
  shouldRenderMessageReceipt,
} from "./chat-receipts.js";

const CURRENT_USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const INCOMING_ID = "33333333-3333-4333-8333-333333333333";

test("receipt UI belongs only to current user's non-system messages", () => {
  assert.equal(shouldRenderMessageReceipt({
    currentUserId: CURRENT_USER_ID,
    message: { senderUserId: CURRENT_USER_ID, receipt: undefined },
  }), true);
  assert.equal(shouldRenderMessageReceipt({
    currentUserId: CURRENT_USER_ID,
    message: { senderUserId: OTHER_USER_ID, receipt: undefined },
  }), false);
  assert.equal(shouldRenderMessageReceipt({
    currentUserId: CURRENT_USER_ID,
    message: { senderUserId: CURRENT_USER_ID, senderRole: "system" },
  }), false);
});

test("missing receipt is sent and aggregate counts advance display state", () => {
  assert.equal(receiptDisplayStatus(undefined), CHAT_RECEIPT_STATUS.SENT);
  assert.equal(receiptDisplayStatus({ status: "sent", deliveredCount: 1 }), CHAT_RECEIPT_STATUS.DELIVERED);
  assert.equal(receiptDisplayStatus({ status: "delivered", readCount: 1 }), CHAT_RECEIPT_STATUS.READ);
});

test("latest receipt boundary excludes own, system, and synthetic messages", () => {
  const messages = [
    { id: INCOMING_ID, senderUserId: OTHER_USER_ID, senderRole: "office", messageType: "normal" },
    { id: "44444444-4444-4444-8444-444444444444", senderUserId: CURRENT_USER_ID, senderRole: "mechanic" },
    { id: "55555555-5555-4555-8555-555555555555", senderUserId: OTHER_USER_ID, senderRole: "system" },
    { id: "office-note", senderUserId: OTHER_USER_ID, senderRole: "office" },
  ];
  assert.equal(latestIncomingChatMessage(messages, CURRENT_USER_ID)?.id, INCOMING_ID);
});

test("read acknowledgement requires active visible focused chat", () => {
  assert.equal(canReadChat({ chatActive: true, documentVisible: true, windowFocused: true }), true);
  assert.equal(canReadChat({ chatActive: false, documentVisible: true, windowFocused: true }), false);
  assert.equal(canReadChat({ chatActive: true, documentVisible: false, windowFocused: true }), false);
  assert.equal(canReadChat({ chatActive: true, documentVisible: true, windowFocused: false }), false);
});

test("ack tracker prevents repeated poll and in-flight duplicate posts", () => {
  const tracker = createChatReceiptAckTracker();
  const workorderId = "66666666-6666-4666-8666-666666666666";

  assert.equal(tracker.claim(workorderId, INCOMING_ID, CHAT_RECEIPT_STATUS.DELIVERED), true);
  assert.equal(tracker.claim(workorderId, INCOMING_ID, CHAT_RECEIPT_STATUS.DELIVERED), false);
  tracker.complete(workorderId, INCOMING_ID, CHAT_RECEIPT_STATUS.DELIVERED, true);
  assert.equal(tracker.claim(workorderId, INCOMING_ID, CHAT_RECEIPT_STATUS.DELIVERED), false);

  assert.equal(tracker.claim(workorderId, INCOMING_ID, CHAT_RECEIPT_STATUS.READ), true);
  tracker.complete(workorderId, INCOMING_ID, CHAT_RECEIPT_STATUS.READ, true);
  assert.equal(tracker.claim(workorderId, INCOMING_ID, CHAT_RECEIPT_STATUS.READ), false);
  assert.equal(tracker.snapshot(workorderId).deliveredId, INCOMING_ID);
  assert.equal(tracker.snapshot(workorderId).readId, INCOMING_ID);
});

test("failed acknowledgement is released for retry", () => {
  const tracker = createChatReceiptAckTracker();
  const workorderId = "77777777-7777-4777-8777-777777777777";
  assert.equal(tracker.claim(workorderId, INCOMING_ID, CHAT_RECEIPT_STATUS.DELIVERED), true);
  tracker.complete(workorderId, INCOMING_ID, CHAT_RECEIPT_STATUS.DELIVERED, false);
  assert.equal(tracker.claim(workorderId, INCOMING_ID, CHAT_RECEIPT_STATUS.DELIVERED), true);
});
