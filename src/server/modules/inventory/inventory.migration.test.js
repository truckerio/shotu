import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("inventory receipt migration preserves Odoo-confirmed serial identity and replay contracts", async () => {
  const sql = await readFile(new URL("../../db/migrations/064_inventory_receipt_serialization.sql", import.meta.url), "utf8");
  assert.match(sql, /unique \(company_id, invoice_run_id\)/i);
  assert.match(sql, /unique \(company_id, serial_number\)/i);
  assert.match(sql, /provider_lot_external_id/i);
  assert.match(sql, /reconciliation_required/i);
  assert.match(sql, /unique \(company_id, receipt_id, action\)/i);
  assert.match(sql, /picking_type_external_id integer not null/i);
  assert.match(sql, /source_location_external_id integer not null/i);
  assert.match(sql, /destination_location_external_id integer not null/i);
  assert.match(sql, /status = 'confirmed' and provider_picking_external_id is not null/i);
});
