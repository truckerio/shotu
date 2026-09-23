import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("found-part count migration and repository keep count adjustments separate from receipts",async()=>{
  const [migration,repository]=await Promise.all([
    readFile(new URL("../migrations/171_inventory_position_count_found_parts.sql",import.meta.url),"utf8"),
    readFile(new URL("./inventory-positions.repo.js",import.meta.url),"utf8"),
  ]);
  assert.match(migration,/line_source[\s\S]*'snapshot'/i);
  assert.match(migration,/check\(line_source in \('snapshot','found'\)\)/i);
  assert.match(migration,/add_found/i);
  const found=repository.slice(repository.indexOf("export async function addPositionCountFoundPart"),repository.indexOf("export async function savePositionCountIdentity"));
  assert.match(found,/expected_quantity,observed_quantity[\s\S]*values\(\$1,\$2,\$3,\$4,\$5,\$6,0,\$7/i);
  assert.match(found,/line_source[\s\S]*'found'/i);
  assert.doesNotMatch(found,/inventory_receipts|purchase_orders|invoice/i);
  const apply=repository.slice(repository.indexOf("export async function applyPositionCountCorrection"));
  assert.match(apply,/missingFoundBalance=!balance&&line\.line_source==="found"/);
  assert.match(apply,/insert into inventory_position_balances/);
  assert.match(apply,/movement_type,quantity_delta[\s\S]*'adjustment'/);
});

test("routine counting submits immutable observations before separate reconciliation",async()=>{
  const repository=await readFile(new URL("./inventory-positions.repo.js",import.meta.url),"utf8");
  const observe=repository.slice(repository.indexOf("export async function savePositionCountObservation"),repository.indexOf("export async function addPositionCountFoundPart"));
  assert.doesNotMatch(observe,/expected_quantity=balance\.quantity|balance_version=balance\.version/);
  const submit=repository.slice(repository.indexOf("export async function submitPositionCountObservations"),repository.indexOf("export async function applyPositionCountCorrection"));
  assert.match(submit,/status='ready'/);
  assert.doesNotMatch(submit,/inventory_stock_movements|quantity_on_hand|count_adjustment/);
  const apply=repository.slice(repository.indexOf("export async function applyPositionCountCorrection"));
  assert.match(apply,/session\.status!=="ready"/);
  assert.match(apply,/Physical count correction/);
});
