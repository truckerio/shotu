import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("unsourced backorders remain valid when workorder cancellation marks them cancelled", async () => {
  const sql = await readFile(
    new URL("../../db/migrations/132_cancel_backordered_fulfillment_legs.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /state in \('backordered', 'cancelled'\)/i);
  assert.match(sql, /route_type = 'internal_transfer'/i);
  assert.match(sql, /source_location_id is null/i);
  assert.match(sql, /source_location_id is not null and source_location_id <> destination_location_id/i);
  assert.doesNotMatch(sql, /state in \([^)]*proposed|state in \([^)]*reserved/i);
});
