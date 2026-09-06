import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("atomic return migration only extends the replay action constraint", async () => {
  const sql = await readFile(
    new URL("../../db/migrations/126_inventory_reuse_atomic_return.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /inventory_reuse_operations_action_check/);
  assert.match(sql, /'receive','return','release'/);
  assert.doesNotMatch(sql, /\b(delete|truncate|update)\s+/i);
});
