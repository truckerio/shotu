import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  decodeChatImageDataUrl,
  persistChatImageAttachment,
  readStoredChatImage,
  sanitizeAttachmentFileName,
} from "./chat-media.service.js";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("validates image bytes instead of trusting the data URL label", () => {
  const decoded = decodeChatImageDataUrl(PNG_DATA_URL);
  assert.equal(decoded.mimeType, "image/png");
  assert.ok(decoded.bytes.length > 0);
  assert.throws(
    () => decodeChatImageDataUrl(PNG_DATA_URL.replace("image/png", "image/jpeg")),
    /does not match/
  );
});

test("sanitizes names and prepares integrity-checked database content", async () => {
  assert.equal(sanitizeAttachmentFileName("../../Fuel pump label (1).PNG", "image/png"), "Fuel-pump-label-1.png");
  const saved = await persistChatImageAttachment({ dataUrl: PNG_DATA_URL, fileName: "../pump.png" });
  assert.match(saved.storageKey, /^[0-9a-f-]{36}\.png$/);
  assert.equal(saved.fileName, "pump.png");
  assert.ok(Buffer.isBuffer(saved.content));
  assert.equal((await readStoredChatImage(saved)).length, saved.byteSize);
  await assert.rejects(
    () => readStoredChatImage({ ...saved, sha256: "0".repeat(64) }),
    /integrity verification/,
  );
});

test("legacy filesystem attachments remain readable during migration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workorder-chat-media-legacy-"));
  const previous = process.env.CHAT_MEDIA_DIR;
  process.env.CHAT_MEDIA_DIR = directory;
  const storageKey = "11111111-1111-4111-8111-111111111111.png";
  const prepared = await persistChatImageAttachment({ dataUrl: PNG_DATA_URL, fileName: "legacy.png" });
  try {
    await writeFile(join(directory, storageKey), prepared.content);
    const bytes = await readStoredChatImage({
      ...prepared,
      content: null,
      storageKey,
    });
    assert.equal(bytes.length, prepared.byteSize);
  } finally {
    if (previous === undefined) delete process.env.CHAT_MEDIA_DIR;
    else process.env.CHAT_MEDIA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
