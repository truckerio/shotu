import assert from "node:assert/strict";
import test from "node:test";
import { isSystemChatMessage, visibleConversationMessages } from "../../components/workorders/chat-messages.js";

test("chat thread hides system messages from the visible conversation", () => {
  const messages = [
    { id: "mechanic", senderRole: "mechanic", messageType: "normal", body: "Need filter" },
    { id: "system-role", senderRole: "system", messageType: "normal", body: "Part request saved." },
    { id: "system-type", senderRole: "office", messageType: "system", body: "Office audit." },
    { id: "office", senderRole: "office", messageType: "normal", body: "Approved" },
  ];

  assert.equal(isSystemChatMessage(messages[1]), true);
  assert.deepEqual(visibleConversationMessages(messages).map((message) => message.id), ["mechanic", "office"]);
});
