import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../db/migrations/029_quantity_units_of_measure.sql", import.meta.url);
const inventoryIdentityMigrationUrl = new URL("../../db/migrations/030_inventory_unit_identity.sql", import.meta.url);
const quantityEnforcementMigrationUrl = new URL("../../db/migrations/031_quantity_scale_enforcement.sql", import.meta.url);

test("quantity migration owns units, decimal storage, compatibility backfill, and inventory view", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /create table if not exists units_of_measure/i);
  assert.match(sql, /update workorder_part_requests set uom_code = 'ea' where uom_code is null/i);
  assert.match(sql, /alter column quantity type numeric\(14,\s*3\)/i);
  assert.match(sql, /create table if not exists part_uom_conversions/i);
  assert.match(sql, /drop view if exists v_inventory_availability/i);
  assert.match(sql, /create view v_inventory_availability[\s\S]*inventory\.uom_code/i);
  assert.match(sql, /foreign key \(company_id,\s*catalog_part_id\)[\s\S]*references parts_catalog\(company_id,\s*id\)/i);
});

test("database enforces whole-number count and packaging quantities", async () => {
  const sql = await readFile(quantityEnforcementMigrationUrl, "utf8");

  assert.match(sql, /create or replace function enforce_part_quantity_unit_scale/i);
  assert.match(sql, /create or replace function enforce_inventory_quantity_unit_scale/i);
  assert.match(sql, /unit_scale = 0[\s\S]*new\.quantity <> trunc\(new\.quantity\)/i);
  assert.match(sql, /create trigger workorder_part_requests_quantity_uom_scale_trigger/i);
  assert.match(sql, /create trigger part_allocations_quantity_uom_scale_trigger/i);
  assert.match(sql, /create trigger inventory_items_quantity_uom_scale_trigger/i);
});

test("inventory identity includes the unit of measure", async () => {
  const sql = await readFile(inventoryIdentityMigrationUrl, "utf8");

  assert.match(sql, /set local lock_timeout = '5s'/i);
  assert.match(sql, /drop index if exists inventory_items_company_location_part_uidx/i);
  assert.match(sql, /create unique index inventory_items_company_location_part_uom_uidx/i);
  assert.match(sql, /normalized_part_number,\s*uom_code/i);
});
