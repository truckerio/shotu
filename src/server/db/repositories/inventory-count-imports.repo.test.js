import assert from "node:assert/strict";
import test from "node:test";
import { inventoryCountImportInternals } from "./inventory-count-imports.repo.js";

test("opening-count batching keeps each internal batch within 500 units", () => {
  const lines = [
    { id: "a", quantity: 500 },
    { id: "b", quantity: 290 },
    { id: "c", quantity: 210 },
    { id: "d", quantity: 500 },
    { id: "e", quantity: 500 },
  ];

  const batches = inventoryCountImportInternals.chunksByUnitLimit(lines);

  assert.equal(inventoryCountImportInternals.batchUnitLimit, 500);
  assert.deepEqual(batches.map((batch) => batch.map((line) => line.id)), [
    ["a"],
    ["b", "c"],
    ["d"],
    ["e"],
  ]);
  assert.ok(batches.every((batch) => batch.reduce((sum, line) => sum + line.quantity, 0) <= 500));
});
