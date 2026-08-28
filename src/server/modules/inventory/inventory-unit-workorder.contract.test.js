import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../db/migrations/069_inventory_unit_workorder_usage.sql", import.meta.url), "utf8");
const repository = readFileSync(new URL("../../db/repositories/inventory-unit-workorder-usage.repo.js", import.meta.url), "utf8");
const workorders = readFileSync(new URL("../../db/repositories/operational-workorders.repo.js", import.meta.url), "utf8");
const server = readFileSync(new URL("../../../../server.js", import.meta.url), "utf8");
const mechanicSurface = readFileSync(new URL("../../../../frontend/src/components/workorders/part-requests/MechanicPartsSurface.jsx", import.meta.url), "utf8");

test("serialized usage migration enforces tenant FKs, one unresolved unit, and exact idempotency", () => {
  assert.match(migration, /foreign key \(company_id, workorder_id\) references operational_workorders\(company_id, id\)/i);
  assert.match(migration, /foreign key \(company_id, unit_id\) references inventory_serialized_units\(company_id, id\)/i);
  assert.match(migration, /where status = 'issued'/i);
  assert.match(migration, /unique \(company_id, issued_by_user_id, issue_idempotency_key\)/i);
  assert.match(migration, /finalize_request_hash char\(64\)/i);
});

test("serialized usage evidence is append-only and stock movements link unit, usage, workorder, and asset", () => {
  assert.match(migration, /event_type in \([\s\S]*'issued'[\s\S]*'installed'[\s\S]*'returned'/i);
  assert.match(migration, /inventory_stock_movements_usage_action_idx/i);
  assert.match(migration, /movement_type in \('issue', 'return'\)/i);
  assert.match(repository, /insert into inventory_unit_events/i);
  assert.doesNotMatch(repository, /update inventory_unit_events/i);
  assert.match(repository, /insert into inventory_stock_movements/i);
  assert.doesNotMatch(repository, /update inventory_stock_movements/i);
});

test("repository locks workorder, exact unit, usage, and local balance before mutation", () => {
  assert.match(repository, /for update of workorder/i);
  assert.match(repository, /for update of unit/i);
  assert.match(repository, /for update of usage, unit/i);
  assert.match(repository, /source_provider = 'local'/i);
  assert.match(repository, /receipt\.provider/i);
  assert.match(repository, /quantity_on_hand = quantity_on_hand - 1/i);
  assert.match(repository, /quantity_on_hand = quantity_on_hand \+ 1/i);
});

test("serialized workflow is wired into the mechanic route and canonical Parts surface", () => {
  assert.match(server, /handleInventoryUnitWorkorderApi/);
  assert.match(mechanicSurface, /<MechanicSerializedParts/);
});

test("workorder lifecycle blocks unresolved exact-unit issues", () => {
  assert.match(workorders, /WORKORDER_SERIALIZED_PARTS_PENDING/);
  assert.match(workorders, /assertNoUnresolvedSerializedParts\(client, workorderId/);
  assert.match(workorders, /changing the workorder unit or location/);
  assert.match(workorders, /before cancelling this workorder/);
  assert.match(workorders, /before changing the mechanic assignment/);
  assert.match(workorders, /before leaving this workorder/);
});
