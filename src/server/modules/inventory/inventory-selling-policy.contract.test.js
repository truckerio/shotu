import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("selling policy migration preserves batch cost and snapshots exact workorder price sources", async () => {
  const sql = await readFile(new URL("../../db/migrations/175_inventory_selling_policies_and_workorder_prices.sql", import.meta.url), "utf8");
  assert.match(sql, /method in \('fixed','markup_percent','markup_amount'\)/i);
  assert.match(sql, /references inventory_receipt_lines\(company_id,id\)/i);
  assert.match(sql, /selection in \('batch_cost','selling_price'\)/i);
  assert.match(sql, /selection='batch_cost' and receipt_line_id is not null/i);
  assert.match(sql, /selection='selling_price' and selling_policy_version_id is not null/i);
  assert.doesNotMatch(sql, /update inventory_receipt_lines/i);
});

test("aggregate FCFS migration separates cost layers from physical positions and snapshots mixed prices", async () => {
  const sql = await readFile(new URL("../../db/migrations/176_inventory_aggregate_fcfs_cost_layers.sql", import.meta.url), "utf8");
  assert.match(sql, /create table inventory_aggregate_cost_layers/i);
  assert.match(sql, /create table inventory_aggregate_usage_cost_allocations/i);
  assert.match(sql, /create table workorder_part_price_snapshot_allocations/i);
  assert.match(sql, /legacy_unassigned/i);
  assert.match(sql, /quantity_reserved numeric\(18,3\)/i);
  assert.doesNotMatch(sql, /update inventory_position_balances/i);
});

test("batch cost corrections are append-only and leave invoice and workorder snapshots immutable", async () => {
  const sql = await readFile(new URL("../../db/migrations/177_inventory_batch_cost_revisions.sql", import.meta.url), "utf8");
  assert.match(sql, /create table inventory_aggregate_cost_layer_revisions/i);
  assert.match(sql, /unique\(company_id,cost_layer_id,version\)/i);
  assert.match(sql, /unique\(company_id,created_by,idempotency_key\)/i);
  assert.match(sql, /previous_revision_id/i);
  assert.doesNotMatch(sql, /update inventory_receipt_lines/i);
  assert.doesNotMatch(sql, /update workorder_part_price_snapshots/i);
});

test("batch placement migration records exact positions and avoids ambiguous legacy guesses", async () => {
  const sql = await readFile(new URL("../../db/migrations/178_inventory_batch_positions.sql", import.meta.url), "utf8");
  assert.match(sql, /create table inventory_aggregate_cost_layer_positions/i);
  assert.match(sql, /quantity_reserved numeric\(18,3\)/i);
  assert.match(sql, /add column position_id uuid/i);
  assert.match(sql, /layer_count=1/i);
  assert.match(sql, /position_count=1/i);
  assert.doesNotMatch(sql, /where true/i);
});

test("legacy active reservations inherit a batch position only from one exact physical allocation", async () => {
  const sql = await readFile(new URL("../../db/migrations/179_inventory_batch_position_reservations.sql", import.meta.url), "utf8");
  assert.match(sql, /having count\(\*\)=1/i);
  assert.match(sql, /cost\.position_id is null/i);
  assert.match(sql, /placement\.position_id=physical\.position_id/i);
  assert.match(sql, /quantity_reserved=reserved\.quantity/i);
  assert.match(sql, /reserved\.quantity<=placement\.quantity_on_hand/i);
});

test("all aggregate batch-cost readers prefer the latest audited correction", async () => {
  const [policies, layers, usages] = await Promise.all([
    readFile(new URL("../../db/repositories/inventory-selling-policies.repo.js", import.meta.url), "utf8"),
    readFile(new URL("../../db/repositories/inventory-aggregate-cost-layers.repo.js", import.meta.url), "utf8"),
    readFile(new URL("../../db/repositories/inventory-aggregate-workorder-usage.repo.js", import.meta.url), "utf8"),
  ]);
  for (const source of [policies, layers, usages]) {
    assert.match(source, /inventory_aggregate_cost_layer_revisions/);
    assert.match(source, /coalesce\(revision\.unit_cost,line\.unit_cost,layer\.unit_cost\)/);
    assert.match(source, /order by correction\.version desc limit 1/);
  }
});

test("batch reads expose exact physical placement without deriving it from part totals", async () => {
  const source = await readFile(new URL("../../db/repositories/inventory-selling-policies.repo.js", import.meta.url), "utf8");
  assert.match(source, /inventory_aggregate_cost_layer_positions/);
  assert.match(source, /position_tree/);
  assert.match(source, /placementStatus/);
  assert.doesNotMatch(source, /inventory_position_balances batch_position/);
});
