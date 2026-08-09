import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../db/migrations/055_chat_attachment_content.sql", import.meta.url),
  "utf8",
);
const repository = readFileSync(new URL("../../db/repositories/chat.repo.js", import.meta.url), "utf8");
const route = readFileSync(new URL("../../routes/mechanic.routes.js", import.meta.url), "utf8");

test("chat attachment bytes persist in PostgreSQL and downloads prefer the stored row", () => {
  assert.match(migration, /add column if not exists content bytea/i);
  assert.match(migration, /octet_length\(content\) = byte_size/i);
  assert.match(repository, /sha256, content\s*\)/s);
  assert.match(repository, /attachment\.content/);
  assert.match(repository, /sha256, content, created_at/);
  assert.match(route, /readStoredChatImage\(attachment\)/);
  assert.doesNotMatch(route, /readStoredChatImage\(attachment\.storageKey\)/);
});
