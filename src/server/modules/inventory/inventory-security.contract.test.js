import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("inventory repositories enforce company and location scope and serialize receipt creation", async () => {
  const source = await readFile(new URL("../../db/repositories/inventory-receipts.repo.js", import.meta.url), "utf8");
  assert.match(source, /pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
  assert.match(source, /existing\.rows\[0\]\.idempotency_key !== idempotencyKey/);
  assert.match(source, /existing\.rows\[0\]\.request_hash !== requestHash/);
  assert.match(source, /unit\.company_id = any\(\$2::uuid\[\]\)/);
  assert.match(source, /\$4::boolean or unit\.location_id = any\(\$3::uuid\[\]\)/);
  assert.match(source, /receipt\.company_id = any\(\$2::uuid\[\]\)/);
  assert.match(source, /\$4::boolean or receipt\.location_id = any\(\$3::uuid\[\]\)/);
  assert.match(source, /odoo_location_warehouse_mappings/);
  assert.match(source, /warehouse\.stock_location_external_id/);
  assert.match(source, /not exists \(select 1 from confirmed_mapping\)/);
});

test("authenticated scan projection excludes invoice, vendor, price, and QR secrets", async () => {
  const source = await readFile(new URL("../../db/repositories/inventory-receipts.repo.js", import.meta.url), "utf8");
  const start = source.indexOf("export async function getSerializedInventoryUnit");
  const projection = source.slice(start);
  assert.doesNotMatch(projection, /invoice_number|vendor_name|unit_price|line_total|qr_token/i);
  assert.match(projection, /provider_picking_name/);
  assert.match(projection, /inventory_unit_events/);
});
