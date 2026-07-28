import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChatPayload,
  createClientMessageId,
  getImageValidationError,
  shouldSubmitChatKey,
} from "./chat-composer-behavior.js";

test("buildChatPayload preserves backend contract and trims body", () => {
  const clientMessageId = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(buildChatPayload("  Need a filter  ", {
    dataUrl: "data:image/png;base64,abc",
    fileName: "filter.png",
    mimeType: "image/png",
    ignored: true,
  }, clientMessageId), {
    body: "Need a filter",
    clientMessageId,
    attachment: {
      dataUrl: "data:image/png;base64,abc",
      fileName: "filter.png",
      mimeType: "image/png",
    },
  });
  assert.deepEqual(buildChatPayload(" photo only ", null, clientMessageId), {
    body: "photo only",
    clientMessageId,
    attachment: null,
  });
});

test("client message identity uses one caller-owned UUID", () => {
  let calls = 0;
  assert.equal(createClientMessageId(() => {
    calls += 1;
    return "22222222-2222-4222-8222-222222222222";
  }), "22222222-2222-4222-8222-222222222222");
  assert.equal(calls, 1);
  assert.throws(() => createClientMessageId(null), /cannot create a message identity/i);
});

test("image validation rejects non-images and oversized images", () => {
  assert.equal(
    getImageValidationError({ type: "application/pdf", size: 12 }),
    "Choose a photo file such as JPG, PNG, or HEIC.",
  );
  assert.equal(
    getImageValidationError({ type: "image/jpeg", size: 101 }, 100),
    "Photo is larger than 10 MB. Choose a smaller photo.",
  );
  assert.equal(getImageValidationError({ type: "image/heic", size: 100 }, 100), "");
});

test("Enter sends while Shift+Enter and composition preserve multiline input", () => {
  assert.equal(shouldSubmitChatKey({ key: "Enter", shiftKey: false, nativeEvent: {} }), true);
  assert.equal(shouldSubmitChatKey({ key: "Enter", shiftKey: false }), true);
  assert.equal(shouldSubmitChatKey({ key: "Enter", shiftKey: true, nativeEvent: {} }), false);
  assert.equal(shouldSubmitChatKey({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: true } }), false);
  assert.equal(shouldSubmitChatKey({ key: "a", shiftKey: false, nativeEvent: {} }), false);
});
