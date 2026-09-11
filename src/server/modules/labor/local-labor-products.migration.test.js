import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("local labor migration is tenant scoped and location pinned", async () => {
  const sql = await readFile(new URL("../../db/migrations/129_local_labor_products.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists local_labor_products/i);
  assert.match(sql, /unique \(company_id, id\)/i);
  assert.match(sql, /local_labor_products_company_name_uidx/i);
  assert.match(sql, /local_labor_products_company_code_uidx/i);
  assert.match(sql, /create table if not exists local_labor_product_location_pins/i);
  assert.doesNotMatch(sql, /odoo_mappings/i);
});

test("local labor product descriptions are optional and capped at the repair-order limit", async () => {
  const sql = await readFile(new URL("../../db/migrations/131_local_labor_product_description.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists description text not null default ''/i);
  assert.match(sql, /char_length\(description\) <= 2000/i);
});
