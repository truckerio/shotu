import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("local inventory migration provides immutable receipt and movement identities", async () => {
  const sql = await readFile(new URL("../../db/migrations/065_local_inventory_ledger.sql", import.meta.url), "utf8");
  assert.match(sql, /create table local_inventory_receipts/i);
  assert.match(sql, /unique \(company_id, invoice_run_id\)/i);
  assert.match(sql, /create table inventory_stock_movements/i);
  assert.match(sql, /unique \(company_id, idempotency_key\)/i);
  assert.match(sql, /foreign key \(company_id, location_id\) references locations\(company_id, id\)/i);
  assert.match(sql, /where source_provider = 'local'/i);
});

test("authority cutover migration preserves the replaced provider snapshot", async () => {
  const sql = await readFile(new URL("../../db/migrations/070_inventory_authority_cutovers.sql", import.meta.url), "utf8");
  assert.match(sql, /create table inventory_authority_cutovers/i);
  assert.match(sql, /previous_source_provider/i);
  assert.match(sql, /previous_external_id/i);
  assert.match(sql, /previous_quantity_on_hand/i);
  assert.match(sql, /previous_quantity_reserved numeric\(14, 3\) not null check \(previous_quantity_reserved = 0\)/i);
  assert.match(sql, /unique \(company_id, receipt_line_id\)/i);
  assert.match(sql, /foreign key \(company_id, inventory_item_id\) references inventory_items\(company_id, id\)/i);
});

test("local serial migration extends the canonical QR identity tables and backfills safely", async () => {
  const sql = await readFile(new URL("../../db/migrations/066_local_inventory_serial_identity.sql", import.meta.url), "utf8");
  assert.match(sql, /provider in \('odoo', 'local'\)/i);
  assert.match(sql, /event_type in \([^)]*'receipt_recorded'/is);
  assert.match(sql, /having sum\(line\.quantity\) <= 500/i);
  assert.match(sql, /uom\.category in \('count', 'packaging'\)/i);
  assert.match(sql, /insert into inventory_serialized_units/i);
  assert.match(sql, /on conflict \(company_id, receipt_line_id, unit_ordinal\) do nothing/i);
});

test("local posting serializes invoice creation while Odoo sync writes its separate projection", async () => {
  const repository = await readFile(new URL("../../db/repositories/local-inventory.repo.js", import.meta.url), "utf8");
  const genericTracking = await readFile(new URL("../../db/migrations/080_inventory_receipt_line_tracking.sql", import.meta.url), "utf8");
  const odoo = await readFile(new URL("../../integrations/odoo/odoo.admin.repo.js", import.meta.url), "utf8");
  assert.match(repository, /pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
  assert.match(repository, /run\.company_id = any\(\$2::uuid\[\]\)/);
  assert.match(repository, /\$4::boolean or run\.location_id = any\(\$3::uuid\[\]\)/);
  assert.match(repository, /movement_type, quantity_delta/);
  assert.match(repository, /insert into inventory_serialized_units/);
  assert.match(repository, /'receipt_recorded'/);
  assert.match(repository, /when inventory_items\.source_provider = 'local'[\s\S]*inventory_items\.quantity_on_hand \+ excluded\.quantity_on_hand[\s\S]*else excluded\.quantity_on_hand/);
  assert.match(repository, /when inventory_items\.source_provider = 'local'[\s\S]*inventory_items\.quantity_reserved[\s\S]*else 0/);
  assert.match(repository, /inventory_items\.source_provider = 'local'[\s\S]*or inventory_items\.quantity_reserved = 0/);
  assert.match(repository, /insert into inventory_authority_cutovers/);
  assert.match(repository, /from inventory_items[\s\S]*where company_id = \$1 and location_id = \$2\s+and normalized_part_number = \$3 and uom_code = \$4\s+limit 1 for update/);
  assert.match(repository, /local_inventory_receipts_company_id_created_by_idempotency__key/);
  assert.match(repository, /inventory_receipts_company_id_invoice_run_id_key/);
  assert.match(genericTracking, /tracking_mode in \('serial', 'aggregate'\)/i);
  assert.match(repository, /line\.serializedUnits\?\.length \? "serial" : "aggregate"/);
  const canonicalLineInsert = repository.indexOf("insert into inventory_receipt_lines");
  const movementInsert = repository.indexOf("insert into inventory_stock_movements");
  assert.ok(canonicalLineInsert > -1 && canonicalLineInsert < movementInsert,
    "canonical receipt line must exist before its movement FK is inserted");
  assert.match(odoo, /insert into odoo_inventory_balances/);
});

test("invoice detail projects durable local receipt truth after refresh", async () => {
  const [repository, inventory] = await Promise.all([
    readFile(new URL("../../db/repositories/invoice-extractions.repo.js", import.meta.url), "utf8"),
    readFile(new URL("../../db/repositories/local-inventory.repo.js", import.meta.url), "utf8"),
  ]);
  assert.match(repository, /left join local_inventory_receipts local_receipt/);
  assert.match(repository, /inventoryReceipt: row\.local_receipt_id/);
  assert.match(repository, /local_receipt\.posted_at as local_receipt_posted_at/);
  assert.match(repository, /left join inventory_label_batches label_batch/);
  assert.match(repository, /labelBatch: row\.label_batch_id/);
  assert.match(inventory, /left join inventory_label_batches label_batch/);
  assert.match(inventory, /printUrl: `\/api\/office\/inventory\/label-batches\/\$\{encodeURIComponent\(row\.label_batch_id\)\}\/print`/);
  assert.match(inventory, /with filtered as/);
  assert.match(inventory, /select count\(\*\)::integer from filtered/);
  assert.match(inventory, /json_agg\(paged order by paged\.created_at desc, paged\.id desc\)/);
  assert.match(inventory, /limit \$6 offset \$7/);
});

test("physical receipt confirmation and immutable label manifests are additive in migration 068", async () => {
  const sql = await readFile(new URL("../../db/migrations/068_local_receipt_confirmation_labels.sql", import.meta.url), "utf8");
  assert.match(sql, /add column reviewed_run_version integer/i);
  assert.match(sql, /physical_confirmation in \('all_received_undamaged', 'legacy_post'\)/i);
  assert.match(sql, /create table inventory_label_batches/i);
  assert.match(sql, /create table inventory_label_batch_items/i);
  assert.match(sql, /unique \(company_id, receipt_id\)/i);
  assert.doesNotMatch(sql, /update inventory_label_batch_items/i);
});

test("migration 082 separates Odoo reference balances from application inventory", async () => {
  const sql = await readFile(new URL("../../db/migrations/082_separate_odoo_and_serialized_local_inventory.sql", import.meta.url), "utf8");
  const odoo = await readFile(new URL("../../integrations/odoo/odoo.admin.repo.js", import.meta.url), "utf8");
  const local = await readFile(new URL("../../db/repositories/local-inventory.repo.js", import.meta.url), "utf8");
  const serialization = await readFile(new URL("../../db/repositories/inventory-part-serialization.repo.js", import.meta.url), "utf8");
  assert.match(sql, /create table odoo_inventory_balances/i);
  assert.match(sql, /source_provider = 'odoo_legacy_reference'/i);
  assert.match(sql, /quantity_on_hand = quantity_reserved/i);
  assert.match(sql, /create table inventory_serialization_batches/i);
  assert.match(sql, /'local_serialization'/i);
  assert.match(odoo, /insert into odoo_inventory_balances/i);
  assert.doesNotMatch(odoo.slice(odoo.indexOf("export async function importOdooInventory")), /insert into inventory_items/i);
  assert.match(local, /item\.source_provider = 'local'/i);
  assert.match(local, /odooQuantityOnHand: Number/i);
  assert.match(local, /join locations catalog_location[\s\S]*catalog_location\.active = true/i);
  assert.match(local, /'quantityOnHand', coalesce\(balance\.quantity_on_hand, 0\)/i);
  assert.match(serialization, /insert into inventory_serialized_units/i);
  assert.match(serialization, /pg_advisory_xact_lock\(hashtext\(\$1\)\)/i);
  assert.match(serialization, /quantity_on_hand = inventory_items\.quantity_on_hand \+ excluded\.quantity_on_hand/i);
  assert.match(serialization, /inventory_display_uom_code \|\| part\.uom_code/i);
});

test("inventory stock applies a whitelisted requested order before pagination", async () => {
  const repository = await readFile(new URL("../../db/repositories/local-inventory.repo.js", import.meta.url), "utf8");
  const stockOrders = [...repository.matchAll(/from filtered\s+order by([\s\S]*?)limit \$6 offset \$7/gi)];
  const orderBy = stockOrders.at(-1)?.[1] || "";
  assert.match(orderBy, /case when \$10 = 'available_desc' then quantity_available end desc/i);
  assert.match(orderBy, /case when \$10 = 'reserved_desc' then quantity_reserved end desc/i);
  assert.match(orderBy, /case when \$10 = 'locations_desc' then location_count end desc/i);
  assert.match(repository, /count\(\*\) filter \([\s\S]*balance\.quantity_on_hand > 0[\s\S]*balance\.odoo_quantity_on_hand > 0[\s\S]*\)::integer as location_count/i);
  assert.match(orderBy, /lower\(part_number\), catalog_part_id/i);
  assert.ok(orderBy.length > 0);
});

test("inventory stock projects the durable UOM lock marker without an activity scan", async () => {
  const repository = await readFile(new URL("../../db/repositories/local-inventory.repo.js", import.meta.url), "utf8");
  assert.match(repository, /catalog\.uom_locked_at/);
  assert.match(repository, /uomLocked: row\.uom_locked_at !== null/);
  assert.doesNotMatch(repository, /const catalogPartIds/);
});
