import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("inventory task queue uses scoped checkpoint pages and keeps detail state independent", async () => {
  const source = await readFile(new URL("./InventoryTaskQueue.jsx", import.meta.url), "utf8");
  assert.match(source, /useCheckpointPages/);
  assert.match(source, /CheckpointCollection/);
  assert.match(source, /total: result\.total, pageCount: result\.pageCount/);
  assert.match(source, /entries\.map\(\(\{ item, key, rowProps \}\)/);
  assert.match(source, /<OperationalDataRow \{\.\.\.rowProps\}/);
  assert.match(source, /const \[selected, setSelected\] = useState\(null\)/);
  assert.match(source, /setSelected\(result\.task\)/);
  assert.doesNotMatch(source, />Previous<|>Next</);
});

test("inventory queue repositories return exact totals from the existing scoped statements", async () => {
  const [queueRepository, stockRepository] = await Promise.all([
    readFile(new URL("../../../../src/server/db/repositories/inventory-task-queue.repo.js", import.meta.url), "utf8"),
    readFile(new URL("../../../../src/server/db/repositories/inventory-stock-tasks.repo.js", import.meta.url), "utf8"),
  ]);
  for (const source of [queueRepository, stockRepository]) {
    assert.match(source, /count\(\*\) over\(\) total_count/);
    assert.match(source, /pageCount:Math\.max\(1,Math\.ceil\(total\//);
  }
  assert.match(queueRepository, /order by queue\.created_at,queue\.source_type,queue\.source_id/);
  assert.match(stockRepository, /order by closed,created_at desc,id desc/);
});
