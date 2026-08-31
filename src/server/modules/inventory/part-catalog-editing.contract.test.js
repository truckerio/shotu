import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("catalog editing migration provides versions, tenant references and transactional audit", async () => {
  const sql = await readFile(new URL("../../db/migrations/084_part_catalog_editing.sql", import.meta.url), "utf8");
  assert.match(sql, /parts_catalog add column if not exists version bigint not null default 1/i);
  assert.match(sql, /unique \(company_id, normalized_reference_number\)/i);
  assert.match(sql, /references parts_catalog\(company_id, id\) on delete cascade/i);
  assert.match(sql, /create table part_catalog_edit_events/i);
  assert.match(sql, /before_state jsonb not null/i);
  assert.match(sql, /version_after = version_before \+ 1/i);
  assert.match(sql, /part_reference_numbers_normalized_prefix_idx/i);
  assert.match(sql, /part_reference_numbers_reference_trgm_idx/i);
});

test("approved workorder requests preserve curated nonblank catalog identity", async () => {
  const source = await readFile(new URL("../../db/repositories/part-requests.repo.js", import.meta.url), "utf8");
  assert.match(source, /part_number = case when btrim\(parts_catalog\.part_number\) = '' then excluded\.part_number else parts_catalog\.part_number end/i);
  assert.match(source, /manufacturer = case when btrim\(parts_catalog\.manufacturer\) = '' then excluded\.manufacturer else parts_catalog\.manufacturer end/i);
  assert.match(source, /description = case when btrim\(parts_catalog\.description\) = '' then excluded\.description else parts_catalog\.description end/i);
  assert.match(source, /category = case when btrim\(parts_catalog\.category\) = '' then excluded\.category else parts_catalog\.category end/i);
});

test("catalog edit repository locks scope and atomically cascades current projections", async () => {
  const source = await readFile(new URL("../../db/repositories/parts-catalog-edit.repo.js", import.meta.url), "utf8");
  assert.match(source, /company_id = any\(\$2::uuid\[\]\).*for update/is);
  assert.match(source, /pg_advisory_xact_lock/i);
  assert.match(source, /insert into part_catalog_edit_events/i);
  assert.match(source, /update inventory_items set normalized_part_number/i);
  assert.match(source, /odoo_product_mappings/i);
  assert.match(source, /uom_locked_at/i);
  assert.match(source, /parts_catalog_uom_locked/i);
});

test("catalog UOM lock migration backfills activity and serializes parent and child writes", async () => {
  const sql = await readFile(new URL("../../db/migrations/088_catalog_uom_activity_lock.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists uom_locked_at timestamptz/i);
  for (const table of ["inventory_items", "local_inventory_receipt_lines", "inventory_receipt_lines", "inventory_stock_movements", "inventory_serialization_batches", "inventory_count_import_lines", "workorder_part_requests", "part_fulfillment_requests", "workorder_serialized_part_usages", "service_history_lines", "part_repair_history", "part_allocations", "part_fulfillment_legs"]) assert.match(sql, new RegExp(table));
  assert.match(sql, /for key share/i);
  assert.match(sql, /parts_catalog_uom_locked/i);
  assert.match(sql, /catalog_uom_activity_uom_mismatch/i);
  assert.match(sql, /coalesce\(uom_locked_at, clock_timestamp\(\)\)/i);
  assert.match(sql, /workorder_part_requests request[\s\S]*join operational_workorders workorder on workorder\.id = request\.workorder_id/i);
  assert.doesNotMatch(sql, /workorder_part_requests_catalog_uom_activity_trigger before insert or update of company_id/i);
  assert.match(sql, /tg_argv\[0\] in \('uom', 'workorder_request_uom'\)/i);
});

test("inventory display UOM migration permits only exact quantity-equivalent aliases", async () => {
  const sql = await readFile(new URL("../../db/migrations/090_inventory_display_uom.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists inventory_display_uom_code text references units_of_measure\(code\)/i);
  assert.match(sql, /inventory_display_uom_not_equivalent/i);
  assert.match(sql, /preferred\.conversion_factor is distinct from canonical\.conversion_factor/i);
  assert.match(sql, /new\.uom_code is distinct from old\.uom_code[\s\S]*inventory_display_uom_code := null/i);
});

test("every catalog writer shares the reference identity lock and advances mutable versions", async () => {
  const [edit, requests, local, odoo] = await Promise.all([
    readFile(new URL("../../db/repositories/parts-catalog-edit.repo.js", import.meta.url), "utf8"),
    readFile(new URL("../../db/repositories/part-requests.repo.js", import.meta.url), "utf8"),
    readFile(new URL("../../db/repositories/local-inventory.repo.js", import.meta.url), "utf8"),
    readFile(new URL("../../integrations/odoo/odoo.admin.repo.js", import.meta.url), "utf8"),
  ]);
  assert.match(edit, /export async function assertPrimaryPartIdentityAvailable/);
  for (const source of [requests, local, odoo]) {
    assert.match(source, /assertPrimaryPartIdentityAvailable\(client,/);
    assert.match(source, /version = parts_catalog\.version \+ case when/);
  }
  assert.match(local, /normalized_reference_number like \$11/);
});
