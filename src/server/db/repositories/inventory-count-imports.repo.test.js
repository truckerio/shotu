import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
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


test("position precision migrations preserve applied history and return legacy ready rows to review", async () => {
  const sql = await readFile(new URL("../migrations/164_inventory_count_import_position_precision.sql", import.meta.url), "utf8");
  const repairSql = await readFile(new URL("../migrations/165_inventory_count_import_legacy_precision_fix.sql", import.meta.url), "utf8");
  assert.match(sql, /quantity type numeric\(18,3\)/i);
  assert.match(sql, /position\.system_key = 'unassigned'/i);
  assert.match(sql, /match_status in \('ready','applied'\)[\s\S]*target_position_id is not null/i);
  assert.match(sql, /foreign key\(company_id,target_position_id\)/i);
  assert.match(repairSql, /set match_status = 'position_required', target_position_id = null/i);
  assert.match(repairSql, /where match_status = 'ready'/i);
  assert.doesNotMatch(repairSql, /where match_status = 'applied'[\s\S]*target_position_id = null/i);
});


test("opening-count quantity policy follows tracking mode and canonical UOM scale", () => {
  const valid = inventoryCountImportInternals.validCatalogQuantity;
  assert.equal(valid({ trackingMode: "quantity", decimalScale: 3, quantity: 1.125 }), false);
  assert.equal(valid({ trackingMode: "quantity", decimalScale: 0, quantity: 2 }), true);
  assert.equal(valid({ trackingMode: "serialized", decimalScale: 0, quantity: 1.5 }), false);
  assert.equal(valid({ trackingMode: "measured_bulk", decimalScale: 3, quantity: 1.125 }), true);
  assert.equal(valid({ trackingMode: "measured_bulk", decimalScale: 2, quantity: 1.125 }), false);
});
