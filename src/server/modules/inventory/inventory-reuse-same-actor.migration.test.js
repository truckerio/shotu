import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("same-actor migration removes only remover inequality checks and retains audited lifecycle fields", async () => {
  const sql = await readFile(
    new URL("../../db/migrations/123_inventory_reuse_same_actor.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /pg_get_constraintdef\(oid\).*received_by_user_id%removed_by_user_id/s);
  assert.match(sql, /pg_get_constraintdef\(oid\).*released_by_user_id%removed_by_user_id/s);
  assert.match(sql, /drop constraint %I/);
  assert.match(sql, /may equal removed_by_user_id/);
  assert.doesNotMatch(sql, /drop column|drop table|disable trigger/i);
});
