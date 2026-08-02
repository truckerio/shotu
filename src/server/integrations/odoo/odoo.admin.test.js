import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { OdooClient } from "./odoo.client.js";
import { odooConfigurationSchema, odooLocationMappingSchema } from "./odoo.admin.schemas.js";

test("Odoo configuration requires a complete connection without accepting extra secrets", () => {
  assert.equal(odooConfigurationSchema.parse({
    baseUrl: "https://example.odoo.com",
    database: "production",
    username: "integration@example.com",
    apiKey: "long-api-key",
  }).database, "production");
  assert.throws(() => odooConfigurationSchema.parse({
    baseUrl: "https://example.odoo.com",
    database: "production",
    username: "integration@example.com",
    apiKey: "short",
  }));
});

test("Odoo location mapping requires an app location only for mapped state", () => {
  const locationId = "2eb1dbef-94a4-4d6d-a6f1-d813cd45fa60";
  assert.deepEqual(odooLocationMappingSchema.parse({ status: "mapped", locationId }), { status: "mapped", locationId });
  assert.deepEqual(odooLocationMappingSchema.parse({ status: "ignored" }), { status: "ignored" });
  assert.throws(() => odooLocationMappingSchema.parse({ status: "mapped" }));
});

test("Odoo client authenticates with an API key and paginates search_read", async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request.params);
    const result = request.params.service === "common"
      ? 17
      : Array.from({ length: request.params.args[6].offset === 0 ? 500 : 1 }, (_, index) => ({ id: index + 1 }));
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  const client = new OdooClient({
    baseUrl: "https://example.odoo.com",
    database: "production",
    username: "integration@example.com",
    apiKey: "long-api-key",
    fetchImpl,
  });
  const records = await client.searchReadAll("stock.location", [], ["id", "name"]);
  assert.equal(records.length, 501);
  assert.equal(calls.filter((call) => call.service === "common").length, 1);
  assert.equal(calls.at(-1).args[6].offset, 500);
});

test("Odoo migration preserves explicit unmatched mapping state and immutable external identity", async () => {
  const sql = await readFile(new URL("../../db/migrations/042_odoo_inventory_sync.sql", import.meta.url), "utf8");
  const productIdentitySql = await readFile(new URL("../../db/migrations/043_odoo_product_identity.sql", import.meta.url), "utf8");
  assert.match(sql, /mapping_status[\s\S]*unmatched[\s\S]*mapped[\s\S]*ignored/i);
  assert.match(sql, /unique \(company_id, external_id\)/i);
  assert.match(sql, /parts_catalog_provider_external_uidx/i);
  assert.match(sql, /inventory_items_provider_external_uidx/i);
  assert.match(productIdentitySql, /unique \(company_id, external_id\)/i);
  assert.match(productIdentitySql, /references parts_catalog\(company_id, id\)/i);
});
