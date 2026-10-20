import assert from "node:assert/strict";
import test from "node:test";
import { getImageAttachments } from "./chat-photo-filter.js";

test("chat photo filter recognizes current and legacy attachment shapes", () => {
  assert.equal(getImageAttachments({ id: "one", attachment: { dataUrl: "data:image/png;base64,abc", fileName: "one.png" } }).length, 1);
  assert.equal(getImageAttachments({ id: "two", attachments: [{ url: "/photo.jpg", mimeType: "image/jpeg" }] }).length, 1);
  assert.equal(getImageAttachments({ id: "three", attachments: [{ url: "/report.pdf", mimeType: "application/pdf" }] }).length, 0);
});
