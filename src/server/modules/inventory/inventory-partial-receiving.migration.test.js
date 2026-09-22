import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../../db/migrations/154_inventory_partial_receiving_batches.sql", import.meta.url);
const readMigration = () => readFile(migrationUrl, "utf8");
const allocationDeleteGuardUrl = new URL("../../db/migrations/158_inventory_allocation_append_only_delete_guard.sql", import.meta.url);
const shortageReceiptUrl = new URL("../../db/migrations/159_inventory_shortage_only_receipts.sql", import.meta.url);
const deliveryHeaderGuardUrl = new URL("../../db/migrations/160_inventory_delivery_header_source_guard.sql", import.meta.url);
const shortageEvidenceGuardUrl = new URL("../../db/migrations/161_inventory_shortage_receipt_evidence_guard.sql", import.meta.url);

test("migration 154 keeps receipt lines as batches and snapshots tracking and source cost", async () => {
  const sql = await readMigration();
  assert.match(sql, /alter table inventory_receipt_lines[\s\S]*add column catalog_tracking_mode varchar\(24\)/i);
  assert.match(sql, /catalog_tracking_mode in \('quantity','serialized','measured_bulk'\)/i);
  assert.match(sql, /add column currency char\(3\)[\s\S]*add column unit_cost numeric\(14,4\)[\s\S]*add column line_total numeric\(14,2\)[\s\S]*add column cost_source varchar\(24\)/i);
  assert.match(sql, /from local_inventory_receipt_lines cost[\s\S]*left join invoice_extraction_runs run/i);
  assert.match(sql, /from inventory_purchase_receipt_allocations purchase_allocation[\s\S]*purchase_line\.unit_price is not null/i);
  assert.doesNotMatch(sql, /create table inventory_(?:stock_)?batches/i);
});

test("migration 154 preserves legacy anomalies and strengthens future receipt identity", async () => {
  const sql = await readMigration();
  assert.match(sql, /create table inventory_receipt_lineage_exceptions/i);
  assert.match(sql, /legacy_inferred_serialization/i);
  assert.match(sql, /serialized_receipt_mismatch/i);
  assert.match(sql, /label_receipt_mismatch/i);
  assert.match(sql, /on conflict do nothing/gi);
  assert.doesNotMatch(sql, /delete from inventory_(?:serialized_units|label_batch_items|receipt_lines)/i);
  assert.match(sql, /foreign key\(company_id,receipt_id,receipt_line_id\)[\s\S]*references inventory_receipt_lines\(company_id,receipt_id,id\)[\s\S]*not valid/i);
  assert.match(sql, /inventory_label_item_receipt_guard/i);
  assert.match(sql, /effective_tracking is distinct from 'serialized'/i);
});

test("migration 154 permits partial invoice receipts without weakening actor replay identity", async () => {
  const sql = await readMigration();
  assert.match(sql, /drop constraint if exists local_inventory_receipts_company_id_invoice_run_id_key/i);
  assert.match(sql, /drop constraint if exists inventory_receipts_company_id_invoice_run_id_key/i);
  assert.match(sql, /inventory_receipts_odoo_invoice_unique[\s\S]*where provider='odoo'/i);
  assert.doesNotMatch(sql, /drop constraint if exists local_inventory_receipts_company_id_created_by_idempotency_key/i);
  assert.match(sql, /physical_confirmation in \('all_received_undamaged','received_on_hold','physically_received','legacy_post'\)/i);
});

test("migration 154 makes posted invoice allocations append-only per receipt line", async () => {
  const sql = await readMigration();
  assert.match(sql, /drop constraint if exists inventory_purchase_invoice_allocations_company_id_invoice_run_id_invoice_line_index_purchase_line_id_key/i);
  assert.match(sql, /inventory_purchase_invoice_allocations_planned_unique[\s\S]*where status='planned'/i);
  assert.match(sql, /inventory_purchase_invoice_allocations_posted_receipt_unique[\s\S]*where status='posted'/i);
  assert.match(sql, /if old\.status='posted'[\s\S]*raise exception 'Posted purchase invoice allocations are append-only\.'/i);
});

test("migration 154 restores receiving statuses and line-level outcome evidence", async () => {
  const sql = await readMigration();
  assert.match(sql, /'ordered','partially_received','received','closed_with_discrepancy','cancelled'/i);
  assert.match(sql, /create table inventory_purchase_deliveries/i);
  assert.match(sql, /order_id uuid,[\s\S]*invoice_run_id uuid,[\s\S]*foreign key\(company_id,invoice_run_id\) references invoice_extraction_runs\(company_id,id\)/i);
  assert.match(sql, /check\(order_id is not null or invoice_run_id is not null\)/i);
  assert.match(sql, /idempotency_key varchar\(120\) not null check\(char_length\(idempotency_key\) between 8 and 120\)/i);
  assert.match(sql, /unique\(company_id,received_by,idempotency_key\)/i);
  assert.match(sql, /create table inventory_purchase_delivery_lines/i);
  assert.match(sql, /purchase_line_id uuid,[\s\S]*invoice_line_index integer check\(invoice_line_index is null or invoice_line_index>=0\)/i);
  assert.match(sql, /check\(purchase_line_id is not null or invoice_line_index is not null\)/i);
  for (const outcome of ["accepted", "damaged", "quarantined", "rejected", "wrong_item", "shortage", "overage"]) {
    assert.match(sql, new RegExp(`'${outcome}'`));
  }
  assert.match(sql, /actual_quantity=usable_quantity\+held_quantity\+rejected_quantity/i);
  assert.match(sql, /outcome<>'damaged' or held_quantity\+rejected_quantity>0/i);
  assert.match(sql, /outcome<>'quarantined' or held_quantity>0/i);
  assert.doesNotMatch(sql, /outcome not in \('damaged','quarantined'\) or held_quantity>0/i);
  assert.match(sql, /outcome='shortage'[\s\S]*receipt_line_id is null[\s\S]*actual_quantity=0/i);
  assert.match(sql, /inventory_purchase_delivery_lines_receipt_unique[\s\S]*where receipt_line_id is not null/i);
  assert.match(sql, /if new\.purchase_line_id is not null then[\s\S]*Purchase delivery line does not belong to the delivery order\./i);
  assert.match(sql, /if new\.invoice_line_index is not null and delivery_invoice_run_id is null then/i);
  assert.match(sql, /inventory_purchase_deliveries_invoice_history[\s\S]*where invoice_run_id is not null/i);
  assert.match(sql, /inventory_purchase_delivery_lines_invoice_line[\s\S]*where invoice_line_index is not null/i);
  assert.match(sql, /Purchase delivery receipt line belongs to a different location\./i);
});

test("migration 154 uses transactional runner conventions and replay-safe backfills", async () => {
  const sql = await readMigration();
  assert.match(sql, /^set local lock_timeout = '5s';/i);
  assert.match(sql, /set local statement_timeout = '60s';/i);
  assert.ok((sql.match(/on conflict do nothing/gi) || []).length >= 4);
  assert.doesNotMatch(sql, /^\s*(?:begin|commit|rollback)\s*;/im);
});

test("migration 158 keeps allocation evidence append-only outside explicit teardown", async () => {
  const sql = await readFile(allocationDeleteGuardUrl, "utf8");
  assert.match(sql, /current_setting\('app\.allow_inventory_evidence_teardown', true\)='on'/i);
  assert.match(sql, /Purchase invoice allocation evidence cannot be deleted\./i);
  assert.match(sql, /Blocks mutation and deletion of allocation evidence/i);
});

test("migration 159 permits shortage evidence without synthetic physical stock lines", async () => {
  const sql = await readFile(shortageReceiptUrl, "utf8");
  assert.match(sql, /line_count between 0 and 500/i);
  assert.match(sql, /total_quantity>=0/i);
  assert.match(sql, /durable shortage evidence only/i);
});

test("migration 160 scopes delivery headers to their PO and invoice location", async () => {
  const sql = await readFile(deliveryHeaderGuardUrl, "utf8");
  assert.match(sql, /Purchase delivery order belongs to a different location\./i);
  assert.match(sql, /Purchase delivery invoice belongs to a different location\./i);
  assert.match(sql, /before insert or update of company_id,order_id,invoice_run_id,location_id/i);
});

test("migration 161 binds zero-line receipts to durable shortage evidence", async () => {
  const sql = await readFile(shortageEvidenceGuardUrl, "utf8");
  assert.match(sql, /line_count=0 and total_quantity=0/i);
  assert.match(sql, /line_count between 1 and 500 and total_quantity>0/i);
  assert.match(sql, /line\.outcome='shortage'/i);
  assert.match(sql, /deferrable initially deferred/i);
});
