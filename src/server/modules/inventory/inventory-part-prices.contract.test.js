import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("price migration keeps version history, explicit Unknown and idempotent commands", async () => {
  const sql = await readFile(new URL("../../db/migrations/133_inventory_part_prices.sql", import.meta.url), "utf8");
  assert.match(sql, /price_kind in \('internal', 'selling'\)/i);
  assert.match(sql, /amount is null and currency is null/i);
  assert.match(sql, /amount is not null and currency is not null/i);
  assert.match(sql, /unique \(company_id, catalog_part_id, price_kind, version\)/i);
  assert.match(sql, /unique \(company_id, created_by, idempotency_key\)/i);
  assert.match(sql, /previous_version_id/i);
});

test("location price migration preserves company defaults and uses null-safe scoped uniqueness", async () => {
  const sql = await readFile(new URL("../../db/migrations/152_inventory_location_price_overrides.sql", import.meta.url), "utf8");
  assert.match(sql, /add column location_id uuid/i);
  assert.match(sql, /foreign key \(company_id, location_id\) references locations\(company_id, id\) on delete restrict/i);
  assert.match(sql, /drop constraint %I/i);
  assert.match(sql, /unique index inventory_part_price_company_version_unique[\s\S]*where location_id is null/i);
  assert.match(sql, /unique index inventory_part_price_location_version_unique[\s\S]*where location_id is not null/i);
  assert.doesNotMatch(sql, /update inventory_part_price_versions/i);
});

test("commercial repository scopes costs by location, includes costless confirmed receipts and bounds each price kind", async () => {
  const source = await readFile(new URL("../../db/repositories/inventory-part-prices.repo.js", import.meta.url), "utf8");
  assert.match(source, /from inventory_receipt_lines line/i);
  assert.match(source, /left join local_inventory_receipt_lines cost/i);
  assert.match(source, /receipt\.status='confirmed'/i);
  assert.match(source, /receipt\.location_id=any\(\$3::uuid\[\]\)/i);
  assert.match(source, /receipt\.location_id=\$5/i);
  assert.match(source, /sum\(line\.quantity\) filter/i);
  assert.match(source, /partition by price_kind, location_id order by version desc/i);
  assert.match(source, /latest: observations\[0\] \|\| null/);
  assert.match(source, /uomCode: part\.uom_code, displayUomCode:/);
  assert.match(source, /source: locationOverride\.length \? "location_override" : companyDefault\.length \? "company_default"/);
  assert.match(source, /basis: "receipt_line_source_facts"/);
  assert.match(source, /from odoo_purchase_history_lines line/i);
  assert.match(source, /basis: "odoo_purchase_order_lines"/);
  assert.match(source, /location_id is not distinct from \$4::uuid/i);
});
