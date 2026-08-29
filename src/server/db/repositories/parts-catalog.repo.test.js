import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryUrl = new URL("./parts-catalog.repo.js", import.meta.url);
const migrationUrl = new URL("../migrations/044_parts_catalog_search.sql", import.meta.url);

test("catalog search remains company scoped and ranks durable identities first", async () => {
  const source = await readFile(repositoryUrl, "utf8");

  assert.match(source, /export async function searchCompanyCatalogParts/);
  assert.match(source, /from parts_catalog pc[\s\S]*where pc\.company_id = \$1/);
  assert.match(source, /normalized_part_number = \$2 then 0/);
  assert.match(source, /then 'exact_barcode'/);
  assert.match(source, /then 'exact_alias'/);
  assert.match(source, /then 'part_prefix'/);
  assert.match(source, /limit \$9/);
});

test("catalog search scopes Odoo mappings and inventory to company and location", async () => {
  const source = await readFile(repositoryUrl, "utf8");

  assert.match(source, /mapping\.company_id = candidates\.company_id/);
  assert.match(source, /item\.company_id = candidates\.company_id/);
  assert.match(source, /item\.location_id = \$8::uuid/);
  assert.match(source, /item\.catalog_part_id = candidates\.id/);
  assert.match(source, /item\.uom_code = candidates\.uom_code/);
});

test("catalog search migration indexes partial text, barcode, and location inventory", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /create extension if not exists pg_trgm/i);
  assert.match(sql, /parts_catalog_normalized_part_trgm_idx/i);
  assert.match(sql, /parts_catalog_part_number_trgm_idx/i);
  assert.match(sql, /parts_catalog_description_trgm_idx/i);
  assert.match(sql, /parts_catalog_aliases_trgm_idx/i);
  assert.match(sql, /odoo_product_mappings_company_barcode_prefix_idx/i);
  assert.match(sql, /inventory_items_catalog_location_lookup_idx/i);
});

test("catalog search uses normalized reference identity so punctuation does not hide matches", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  assert.match(source, /reference\.normalized_reference_number like \$4/);
  assert.match(source, /then 'exact_reference_number'/);
});
