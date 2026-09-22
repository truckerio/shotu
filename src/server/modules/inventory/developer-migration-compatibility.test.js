import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const migrationsUrl = new URL("../../db/migrations/", import.meta.url);
const readMigration = (name) => readFile(new URL(name, migrationsUrl), "utf8");
const normalized = (sql) => sql.replace(/\s+/g, " ").toLowerCase();

test("developer migrations follow the existing 135 migration head without collisions", async () => {
  const names = (await readdir(migrationsUrl)).filter((name) => name.endsWith(".sql"));
  const expected = [
    "136_direct_inventory_receipts.sql",
    "137_inventory_purchasing.sql",
    "138_inventory_stock_tasks.sql",
    "139_inventory_supplier_bills.sql",
    "140_inventory_workflow_evidence.sql",
    "141_inventory_exact_count_observations.sql",
    "142_inventory_purchase_requests.sql",
    "143_purchase_request_workorder_link.sql",
    "144_purchase_request_receipts.sql",
    "145_purchase_order_placement.sql",
    "146_purchase_uncatalogued_lines.sql",
    "147_purchase_order_approval.sql",
    "148_unify_inventory_receipt_sources.sql",
    "149_purchase_delivery_confirmation.sql",
    "150_purchase_order_bill_documents.sql",
    "151_purchase_delivery_condition.sql",
  ];

  for (const name of expected) assert.ok(names.includes(name), `missing ${name}`);
  for (let number = 133; number <= 151; number += 1) {
    assert.equal(names.filter((name) => name.startsWith(`${number}_`)).length, 1, `migration ${number} must have one owner`);
  }
});

test("direct receipt migration preserves manual receipt sources introduced by migration 130", async () => {
  const historical = normalized(await readMigration("130_inventory_manual_stock_intake.sql"));
  const direct = normalized(await readMigration("136_direct_inventory_receipts.sql"));

  assert.doesNotMatch(historical, /local_direct|direct_receipt/);
  assert.match(direct, /provider in \('odoo','local','local_count','local_serialization','legacy_tracking','local_manual','local_direct'\)/);
  assert.match(direct, /provider='local_manual'[\s\S]*manual_intake_batch_id is not null/);
  assert.match(direct, /provider in \('legacy_tracking','local_direct'\)[\s\S]*manual_intake_batch_id is null/);
  assert.match(direct, /movement_type in \('invoice_receipt','manual_receipt','direct_receipt'/);
});

test("final receipt-source reconciliation retains the same manual and direct union", async () => {
  const sql = normalized(await readMigration("148_unify_inventory_receipt_sources.sql"));

  assert.match(sql, /provider in \('odoo','local','local_count','local_serialization','legacy_tracking','local_direct','local_manual'\)/);
  assert.match(sql, /provider='local_manual'[\s\S]*manual_intake_batch_id is not null/);
  assert.match(sql, /provider in \('legacy_tracking','local_direct'\)[\s\S]*manual_intake_batch_id is null/);
  assert.match(sql, /movement_type in \('invoice_receipt','manual_receipt','direct_receipt'/);
  assert.match(sql, /tracking_mode <> 'serial'[\s\S]*quantity = trunc\(quantity\)/);
});
