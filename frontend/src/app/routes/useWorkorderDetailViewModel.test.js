import assert from "node:assert/strict";
import test from "node:test";

import {
  assignedMechanicIdsFromDetail,
  conversationMessagesFromDetail,
  pendingPartRequestCount,
} from "./workorder-detail-view-model.js";

test("detail view model derives assigned mechanics from canonical team", () => {
  const detail = { workorder: { mechanics: [{ id: "m2" }, { id: "m1" }] } };
  assert.deepEqual(assignedMechanicIdsFromDetail(detail), ["m2", "m1"]);
});

test("detail view model includes an office note and hides system chat noise", () => {
  const messages = conversationMessagesFromDetail({
    workorder: { officeNotes: "Inspect the air line." },
    messages: [
      { id: "message-1", senderRole: "mechanic", body: "Leak found.", messageType: "normal" },
      { id: "message-2", senderRole: "system", body: "Status changed.", messageType: "system" },
    ],
  });
  assert.deepEqual(messages.map((message) => message.id), ["office-note", "message-1"]);
});

test("detail view model counts only unresolved part requests", () => {
  const detail = {
    partRequests: [
      { status: "pending" },
      { status: "approved" },
      { status: "rejected" },
      { status: "needs_info" },
    ],
  };
  assert.equal(pendingPartRequestCount(detail), 2);
});
