import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { partsCatalogInternals } from "./parts-catalog.repo.js";

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
  assert.match(source, /item\.source_provider = 'local'/);
  assert.match(source, /item\.catalog_part_id = candidates\.id/);
  assert.match(source, /item\.uom_code = candidates\.uom_code/);
  assert.match(source, /inventory_replenishment_alerts alert[\s\S]*alert\.company_id = item\.company_id[\s\S]*alert\.location_id = item\.location_id[\s\S]*alert\.catalog_part_id = item\.catalog_part_id[\s\S]*alert\.resolved_at is null/);
  assert.match(source, /inventory_position_balances balance[\s\S]*balance\.company_id = item\.company_id[\s\S]*balance\.location_id = item\.location_id[\s\S]*balance\.inventory_item_id = item\.id/);
  assert.match(source, /inventory_serialized_units unit[\s\S]*unit\.company_id = item\.company_id[\s\S]*unit\.location_id = item\.location_id[\s\S]*receipt_line\.catalog_part_id = item\.catalog_part_id/);
  assert.match(source, /balance\.quantity > 0[\s\S]*coalesce\(candidates\.tracking_mode, 'quantity'\) <> 'serialized'/);
  assert.match(source, /unit\.status in \('in_stock', 'reserved'\)[\s\S]*coalesce\(candidates\.tracking_mode, 'quantity'\) = 'serialized'/);
  assert.match(source, /physical_position\.code as bin_location/);
  assert.doesNotMatch(source, /item\.bin_location,/);
});

test("operational catalog search is purpose-gated by local availability", async () => {
  const source = await readFile(repositoryUrl, "utf8");

  assert.match(source, /\["issue", "request", "master_match", "workorder_assignment"\]\.includes\(values\.purpose\)/);
  assert.match(source, /join units_of_measure uom[\s\S]*uom\.category <> 'time'/);
  assert.match(source, /\$11::text in \('master_match', 'workorder_assignment'\)/);
  assert.match(source, /inventory\.id is not null[\s\S]*\$11::text = 'request'[\s\S]*inventory\.quantity_available > 0/);
  assert.match(source, /case when inventory\.id is not null then 'local'/);
  assert.match(source, /source: row\.inventory_item_id \? "local"/);
  assert.match(source, /trackingMode: row\.tracking_mode \|\| null/);
  assert.match(source, /join units_of_measure uom on uom\.code = pc\.uom_code and uom\.active/);
});

test("public catalog parts expose canonical UOM precision", () => {
  const part = partsCatalogInternals.publicCatalogPart({
    id: "part-1",
    part_number: "OIL-1",
    normalized_part_number: "OIL1",
    uom_code: "hr",
    tracking_mode: "measured_bulk",
    decimal_scale: 2,
  });

  assert.equal(part.uomCode, "hr");
  assert.equal(part.trackingMode, "measured_bulk");
  assert.equal(part.decimalScale, 2);
});

test("public catalog inventory exposes location low-stock evidence", () => {
  const part = partsCatalogInternals.publicCatalogPart({
    id: "part-1",
    part_number: "OIL-1",
    normalized_part_number: "OIL1",
    uom_code: "ea",
    inventory_item_id: "stock-1",
    inventory_location_id: "location-1",
    quantity_available: 2,
    low_stock: true,
  });

  assert.equal(part.inventory.available, 2);
  assert.equal(part.inventory.lowStock, true);
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
