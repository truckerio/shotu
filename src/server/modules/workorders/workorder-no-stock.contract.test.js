import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../../db/migrations/197_no_stock_workorder_prices.sql", import.meta.url), "utf8");
const createRepository = await readFile(new URL("../../db/repositories/operational-workorders.repo.js", import.meta.url), "utf8");
const priceRepository = await readFile(new URL("../../db/repositories/workorder-part-pricing.repo.js", import.meta.url), "utf8");
const documentRepository = await readFile(new URL("../../db/repositories/customer-document-workorder-source.repo.js", import.meta.url), "utf8");
const priceRegistry = await readFile(new URL("./workorder-module-runtime.registry.js", import.meta.url), "utf8");
const usedParts = await readFile(new URL("../../db/repositories/operational-workorders.repo.js", import.meta.url), "utf8");
const positionsRepository = await readFile(new URL("../../db/repositories/inventory-positions.repo.js", import.meta.url), "utf8");
const tasksRepository = await readFile(new URL("../../db/repositories/inventory-stock-tasks.repo.js", import.meta.url), "utf8");
const stockingRepository = await readFile(new URL("../../db/repositories/inventory-stocking-policy.repo.js", import.meta.url), "utf8");

test("no-stock price snapshots use direct Workorder line evidence instead of inventory usage", () => {
  assert.match(migration, /add column no_stock_line_id uuid/i);
  assert.match(migration, /no_stock_line_id is not null and catalog_part_id is not null and uom_code is not null/i);
  assert.match(migration, /selection='batch_cost'[\s\S]*no_stock_line_id is null/i);
  assert.match(priceRepository, /catalog\.tracking_mode='no_stock'/i);
  assert.match(priceRepository, /candidate->>'noStockLineId'=\$2/);
  assert.match(priceRepository, /row\.method !== "fixed"/);
  assert.match(priceRepository, /no_stock_line_id,catalog_part_id,uom_code,selection/i);
  assert.doesNotMatch(priceRepository, /noStock[\s\S]{0,200}inventory_stock_movements/i);
});

test("post-create no-stock identity remains server-owned and can be priced by line id", () => {
  assert.match(priceRegistry, /usageKind: z\.enum\(\["serialized", "aggregate", "no_stock"\]\)/);
  assert.match(priceRegistry, /noStockLineId: id\.optional\(\)/);
  assert.match(usedParts, /priorNoStockByLineId/);
  assert.match(usedParts, /noStockLineId = priorNoStock\?\.noStockLineId \|\| randomUUID\(\)/);
  assert.match(usedParts, /WORKORDER_NO_STOCK_IDENTITY_INVALID/);
  assert.match(usedParts, /catalog\.tracking_mode !== "no_stock"/);
  assert.doesNotMatch(usedParts, /No-stock Workorder lines cannot be removed/);
});

test("Workorder creation derives no-stock behavior from canonical catalog policy", () => {
  assert.match(createRepository, /select id,tracking_mode,uom_code from parts_catalog/i);
  assert.match(createRepository, /catalogPolicy\?\.tracking_mode === "no_stock"/);
  assert.match(createRepository, /WORKORDER_NO_STOCK_UOM_MISMATCH/);
  assert.match(createRepository, /noStockLineId: noStockLineIds\.get\(originalIndex\)/);
  assert.match(createRepository, /usageKind: "no_stock"/);
});

test("customer documents require a current selling snapshot for every no-stock line", () => {
  assert.match(documentRepository, /snapshot\.no_stock_line_id is not null/);
  assert.match(documentRepository, /currentNoStockParts\.size !== noStock\.length/);
  assert.match(documentRepository, /sourceKind: "no_stock_line"/);
});

test("physical inventory owners explicitly admit only physical tracking modes", () => {
  assert.match(positionsRepository, /part\.tracking_mode in \('quantity','measured_bulk'\)/);
  assert.match(positionsRepository, /\["quantity","serialized","measured_bulk"\]\.includes\(stock\.tracking_mode\)/);
  assert.match(tasksRepository, /\["quantity","serialized","measured_bulk"\]\.includes\(part\.tracking_mode\)/);
  assert.match(stockingRepository, /part\.tracking_mode in \('quantity','serialized','measured_bulk'\)/);
});
