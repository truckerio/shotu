import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  UOM_BY_CODE,
  UOM_CATEGORIES,
  normalizeQuantity,
  quantityStep,
} from "../../../../shared/units-of-measure.js";

const migrationUrl = new URL("../../db/migrations/048_odoo_outbound_service_orders.sql", import.meta.url);

test("outbound Odoo migration persists discovered provider truth and explicit mappings", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create table odoo_vehicles/i);
  assert.match(sql, /create table odoo_warehouses/i);
  assert.match(sql, /create table odoo_service_products/i);
  assert.match(sql, /mapping_status in \('unmatched', 'suggested', 'mapped', 'ignored'\)/i);
  assert.match(sql, /mapping_status = 'mapped'[\s\S]*app_asset_id is not null[\s\S]*confirmed_at is not null/i);
  assert.match(sql, /odoo_vehicles_confirmed_asset_uidx[\s\S]*where mapping_status = 'mapped'/i);
  assert.match(sql, /unique \(company_id, external_id\)/i);
  assert.match(sql, /create table odoo_location_warehouse_mappings/i);
  assert.match(sql, /unique \(company_id, location_id\)/i);
  assert.match(sql, /unique \(company_id, warehouse_external_id\)/i);
});

test("outbound mapping and readiness records enforce tenant ownership", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const owner of [
    "assets(company_id, id)",
    "locations(company_id, id)",
    "odoo_warehouses(company_id, external_id)",
    "operational_workorders(company_id, id)",
    "integration_accounts(company_id, id)",
    "odoo_service_products(company_id, external_id)",
  ]) {
    assert.match(sql, new RegExp(`references ${owner.replace(/[()]/g, "\\$&")}`, "i"));
  }
  assert.match(sql, /create table odoo_workorder_preparation/i);
  assert.match(sql, /labor_hours > 0[\s\S]*scale\(labor_hours\) <= 2/i);
  assert.match(sql, /unique \(company_id, workorder_id\)/i);
  assert.match(sql, /create table odoo_service_order_settings/i);
});

test("outbound order state and attempt snapshots make retries auditable", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create table odoo_outbound_orders/i);
  assert.match(sql, /state in \('prepared', 'creating', 'retryable_failure', 'exported', 'conflict'\)/i);
  assert.match(sql, /payload_hash ~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(sql, /payload_snapshot jsonb not null/i);
  assert.match(sql, /unique \(company_id, stable_marker\)/i);
  assert.match(sql, /odoo_outbound_orders_external_uidx[\s\S]*where external_id is not null/i);
  assert.match(sql, /create table odoo_outbound_order_attempts/i);
  assert.match(sql, /request_snapshot jsonb not null/i);
  assert.match(sql, /unique \(company_id, outbound_order_id, attempt_no\)/i);
});

test("canonical hours use time category and two-decimal quantities", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /'time'/i);
  assert.match(sql, /values \('hr', 'Hour', 'hr', 'time', 2, 'hr', 1, 'Hours'/i);
  assert.equal(UOM_CATEGORIES.time.decimalScale, 2);
  assert.equal(UOM_BY_CODE.hr.odooName, "Hours");
  assert.equal(normalizeQuantity("0.50", "hr"), "0.5");
  assert.equal(quantityStep("hr"), "0.01");
});
