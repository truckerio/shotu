import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { OdooClient } from "./odoo.client.js";
import {
  odooConfigurationSchema,
  odooLocationMappingSchema,
  odooOutboundLaborProductSchema,
  odooOutboundInternalIdSchema,
  odooOutboundVehicleListSchema,
  odooOutboundProviderVehicleListSchema,
  odooOutboundVehicleMappingSchema,
  odooOutboundWarehouseMappingSchema,
} from "./odoo.admin.schemas.js";
import { buildOdooInventoryBalances, repairTextFromOdooLine } from "./odoo.admin.repo.js";
import { readOdooServiceHistory } from "./odoo.admin.service.js";

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

test("Odoo outbound mapping schemas require explicit provider identities", () => {
  assert.deepEqual(
    odooOutboundVehicleMappingSchema.parse({ status: "mapped", externalId: "17968" }),
    { status: "mapped", externalId: "17968" },
  );
  assert.deepEqual(
    odooOutboundWarehouseMappingSchema.parse({ status: "mapped", externalId: "28" }),
    { status: "mapped", externalId: "28" },
  );
  assert.deepEqual(odooOutboundVehicleMappingSchema.parse({ status: "unmatched" }), { status: "unmatched" });
  assert.throws(() => odooOutboundVehicleMappingSchema.parse({ status: "mapped" }));
  assert.throws(() => odooOutboundWarehouseMappingSchema.parse({ status: "ignored" }));
  assert.equal(odooOutboundLaborProductSchema.parse({ productExternalId: "85226" }).productExternalId, "85226");
});

test("Odoo outbound vehicle query is bounded", () => {
  assert.deepEqual(odooOutboundVehicleListSchema.parse({}), {
    status: "all", q: "", limit: 50, cursor: 0,
  });
  assert.equal(odooOutboundVehicleListSchema.parse({ status: "suggested" }).status, "suggested");
  assert.equal(odooOutboundVehicleListSchema.parse({ limit: "100" }).limit, 100);
  assert.throws(() => odooOutboundVehicleListSchema.parse({ limit: "101" }));
  assert.equal(odooOutboundProviderVehicleListSchema.parse({ q: "579", limit: "50" }).limit, 50);
  assert.throws(() => odooOutboundProviderVehicleListSchema.parse({ limit: "51" }));
});

test("Odoo outbound discovery auto-matches only deterministic vehicle identities", async () => {
  const repository = await readFile(new URL("./odoo.admin.repo.js", import.meta.url), "utf8");
  const service = await readFile(new URL("./odoo.admin.service.js", import.meta.url), "utf8");
  const routes = await readFile(new URL("../../routes/integrations.routes.js", import.meta.url), "utf8");

  assert.match(repository, /autoMatchOdooOutboundVehiclesInTransaction/);
  assert.match(repository, /for \(const basis of \["vin", "license_plate"\]\)/);
  assert.match(repository, /asset_match_count = 1 and vehicle_match_count = 1/);
  assert.match(repository, /mapping_status = 'mapped'/);
  assert.match(repository, /mapping_status = 'suggested'/);
  assert.match(repository, /suggestion_basis = 'unit_number'/);
  assert.match(repository, /suggestion_basis = 'license_plate_vin_conflict'/);
  assert.match(repository, /outbound\.vehicle_auto_match_completed/);
  assert.match(service, /upsertOdooOutboundDiscovery\(companyId, \{ vehicles, warehouses, serviceProducts, uoms, actor \}\)/);
  assert.match(routes, /discoverOdooOutbound\(companyId, \{[\s\S]*userId: requestContext\.actor\.id/);
});

test("Odoo outbound mapping paths reject malformed internal IDs before database access", () => {
  assert.equal(
    odooOutboundInternalIdSchema.parse("2eb1dbef-94a4-4d6d-a6f1-d813cd45fa60"),
    "2eb1dbef-94a4-4d6d-a6f1-d813cd45fa60",
  );
  assert.throws(() => odooOutboundInternalIdSchema.parse("not-a-uuid"));
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
  const records = await client.searchReadAll("stock.location", [], ["id", "name"], {
    context: { active_test: false },
  });
  assert.equal(records.length, 501);
  assert.equal(calls.filter((call) => call.service === "common").length, 1);
  assert.equal(calls.at(-1).args[6].offset, 500);
  assert.deepEqual(calls.at(-1).args[6].context, { active_test: false });
});

test("Odoo client marks a response timeout as an unknown transport outcome", async () => {
  const abortError = new Error("aborted");
  abortError.name = "AbortError";
  const client = new OdooClient({
    baseUrl: "https://example.odoo.com",
    database: "production",
    username: "integration@example.com",
    apiKey: "long-api-key",
    fetchImpl: async () => { throw abortError; },
  });
  await assert.rejects(
    () => client.authenticate(),
    (error) => error.code === "ODOO_CONNECTION_TIMEOUT",
  );
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

test("Odoo inventory collapses provider locations and duplicate product identities into one app balance", () => {
  const appLocationId = "2eb1dbef-94a4-4d6d-a6f1-d813cd45fa60";
  const catalogPartId = "7283dc5e-5f40-4e27-87cf-c25a7e247f37";
  const mappedLocations = new Map([["38", appLocationId], ["334", appLocationId]]);
  const product = {
    id: catalogPartId,
    normalized: "A83911",
    partNumber: "A83911",
    description: "Air valve",
    uomCode: "ea",
    decimalScale: 0,
  };
  const catalogIds = new Map([["40409", product], ["99999", product]]);
  const balances = buildOdooInventoryBalances({
    mappedLocations,
    catalogIds,
    quants: [
      { product_id: [40409, "Air valve"], location_id: [38, "Stock"], available_quantity: 20, write_date: "2026-08-20" },
      { product_id: [40409, "Air valve"], location_id: [334, "Shelf"], available_quantity: 2, write_date: "2026-08-21" },
      { product_id: [99999, "Air valve alias"], location_id: [334, "Shelf"], available_quantity: 3, write_date: "2026-08-22" },
      { product_id: [40409, "Air valve"], location_id: [777, "Unmapped"], available_quantity: 100 },
    ],
  });

  assert.equal(balances.size, 1);
  const balance = [...balances.values()][0];
  assert.equal(balance.availableQuantity, 25);
  assert.equal(balance.providerUpdatedAt, "2026-08-22");
  assert.equal(
    balance.externalId,
    `catalog:${catalogPartId}:location:${appLocationId}:uom:ea`,
  );
});

test("Odoo sync imports catalog mappings without provider quantities or local identity overwrite", async () => {
  const repository = await readFile(new URL("./odoo.admin.repo.js", import.meta.url), "utf8");
  const importer = repository.slice(repository.indexOf("export async function importOdooInventory"));
  assert.match(importer, /select catalog_part_id from odoo_product_mappings/);
  assert.doesNotMatch(importer, /insert into odoo_inventory_balances|update odoo_inventory_balances|insert into inventory_items/);
  assert.doesNotMatch(importer, /on conflict \(company_id, normalized_part_number\) do update/);
  assert.doesNotMatch(importer, /set catalog_part_id = excluded\.catalog_part_id/);
  assert.match(importer, /provider_updated_at, last_seen_at, updated_at[\s\S]*\$8, \$9, now\(\)/);
  assert.doesNotMatch(importer, /update odoo_product_mappings[\s\S]*set active = false/);
  assert.match(importer, /product\.active !== false/);
});

test("Odoo catalog sync fetches inactive products explicitly and never infers state from absence", async () => {
  const service = await readFile(new URL("./odoo.admin.service.js", import.meta.url), "utf8");
  const repository = await readFile(new URL("./odoo.admin.repo.js", import.meta.url), "utf8");
  const sync = service.slice(service.indexOf("export async function syncOdooPartsAndInventory"));
  const importer = repository.slice(repository.indexOf("export async function importOdooInventory"));
  assert.match(sync, /searchReadAll\("product\.product", \[\],[\s\S]*active_test: false/);
  assert.match(sync, /"active"/);
  assert.doesNotMatch(importer, /last_seen_at is distinct from|not in\s*\(/i);
  assert.match(importer, /active = excluded\.active/);
});

test("Odoo repair text keeps work performed and does not treat generic labor product names as repairs", () => {
  assert.equal(repairTextFromOdooLine({
    name: "[PTR001] LABOR HOURS\nPUT NEW HUB SEAL, ADJUST BRAKES",
    product_id: [71, "[PTR001] LABOR HOURS"],
  }, { name: "LABOR HOURS" }), "PUT NEW HUB SEAL, ADJUST BRAKES");
  assert.equal(repairTextFromOdooLine({ name: "LABOR HOURS" }, { name: "LABOR HOURS" }), "");
  assert.equal(repairTextFromOdooLine({ name: "Inspect and repair air leak" }, { name: "Labor" }), "Inspect and repair air leak");
  assert.equal(repairTextFromOdooLine({ name: "Replace leaking trailer seal" }, { name: "Shop Service" }), "Replace leaking trailer seal");
});

test("Odoo service-history read is confirmed-order only, introspected, ordered, and bounded", async () => {
  const calls = [];
  const allFields = {
    id: {}, name: {}, state: {}, date_order: {}, effective_date: {}, commitment_date: {}, write_date: {},
    is_service_order: {}, vehicle_id: {},
    order_id: {}, sequence: {}, display_type: {}, product_id: {}, product_uom_qty: {}, product_uom: {},
    default_code: {}, barcode: {}, type: {}, detailed_type: {},
  };
  const client = {
    async execute(model, method, args, kwargs) {
      calls.push({ model, method, args, kwargs });
      if (method === "fields_get") return allFields;
      if (model === "sale.order") return [{
        id: 10,
        name: "S001",
        state: "sale",
        is_service_order: true,
        vehicle_id: [77, "FREIGHTLINER/G2116"],
        write_date: "2026-08-01T00:00:00Z",
      }];
      if (model === "sale.order.line") return [
        { id: 102, order_id: [10, "S001"], sequence: 20, product_id: [2, "Seal"] },
        { id: 101, order_id: [10, "S001"], sequence: 10, product_id: [1, "Labor"] },
      ];
      return [
        { id: 1, name: "Labor", detailed_type: "service" },
        { id: 2, name: "Seal", detailed_type: "product", default_code: "46305" },
      ];
    },
  };
  const result = await readOdooServiceHistory(client, { updatedSince: "2026-07-31T00:00:00Z" });
  assert.equal(result.orders.length, 1);
  assert.equal(result.lines.length, 2);
  assert.equal(result.products.length, 2);
  assert.equal(result.activeOrderIds, null);
  assert.deepEqual(result.inactiveOrderIds, []);
  assert.deepEqual(result.orders[0].vehicle_id, [77, "FREIGHTLINER/G2116"]);
  const orderReads = calls.filter((call) => call.model === "sale.order" && call.method === "search_read");
  assert.equal(orderReads.length, 2);
  assert.equal(orderReads[0].args[0][0][0], "write_date");
  assert.match(orderReads[0].args[0][0][2], /^2026-07-30 23:55:00$/);
  assert.equal(orderReads[0].args[0].some((term) => term[0] === "is_service_order"), false);
  assert.deepEqual(orderReads[1].args[0][0], ["id", "in", [10]]);
  assert.deepEqual(orderReads[1].args[0][1], ["state", "in", ["sale", "done"]]);
  assert.deepEqual(orderReads[1].args[0][2], ["is_service_order", "=", true]);
  assert.equal(orderReads[0].kwargs.order, "id asc");
  assert.equal(orderReads[0].kwargs.limit, 500);
  assert.ok(calls.filter((call) => call.method === "search_read").every((call) => call.args[0].some((term) => term[0] === "id" && term[1] === ">")));
});

test("incremental Odoo history reloads an order when only a line write date changes", async () => {
  const calls = [];
  const fields = {
    id: {}, name: {}, state: {}, write_date: {}, order_id: {}, sequence: {},
    is_service_order: {}, vehicle_id: {},
    product_id: {}, display_type: {}, product_uom_qty: {}, product_uom: {}, detailed_type: {}, default_code: {},
  };
  const client = {
    async execute(model, method, args, kwargs) {
      calls.push({ model, method, args, kwargs });
      if (method === "fields_get") return fields;
      const domain = args[0] || [];
      if (model === "sale.order") {
        if (domain.some((term) => term[0] === "write_date")) return [];
        return [{ id: 10, name: "S001", state: "sale", is_service_order: true, write_date: "2026-08-01 00:00:00" }];
      }
      if (model === "sale.order.line") {
        if (domain.some((term) => term[0] === "write_date")) {
          return [{ id: 102, order_id: [10, "S001"], write_date: "2026-08-03 10:00:00" }];
        }
        return [{ id: 102, order_id: [10, "S001"], sequence: 20, product_id: [2, "Seal"] }];
      }
      return [{ id: 2, name: "Seal", detailed_type: "product", default_code: "46305" }];
    },
  };
  const result = await readOdooServiceHistory(client, { updatedSince: "2026-08-03T09:00:00Z" });
  assert.deepEqual(result.orders.map((order) => order.id), [10]);
  assert.deepEqual(result.lines.map((line) => line.id), [102]);
  assert.equal(result.activeOrderIds, null);
  assert.deepEqual(result.inactiveOrderIds, []);
  assert.ok(calls.some((call) => call.model === "sale.order.line" && call.method === "search_read"
    && call.args[0].some((term) => term[0] === "write_date")));
});

test("incremental Odoo history removes cancelled records and records that lose the service-order flag", async () => {
  const fields = { id: {}, name: {}, state: {}, write_date: {}, order_id: {}, is_service_order: {}, vehicle_id: {} };
  const client = {
    async execute(model, method, args) {
      if (method === "fields_get") return fields;
      const domain = args[0] || [];
      if (model === "sale.order" && domain.some((term) => term[0] === "write_date")) {
        return [
          { id: 10, state: "cancel", is_service_order: true },
          { id: 11, state: "sale", is_service_order: false },
        ];
      }
      if (model === "sale.order") return [];
      if (model === "sale.order.line") return [];
      return [];
    },
  };
  const result = await readOdooServiceHistory(client, { updatedSince: "2026-08-03T09:00:00Z" });
  assert.deepEqual(result.orders, []);
  assert.deepEqual(result.inactiveOrderIds, ["10", "11"]);
});

test("periodic Odoo reconciliation reloads all active service orders and returns their complete identity set", async () => {
  const fields = { id: {}, name: {}, state: {}, write_date: {}, order_id: {}, is_service_order: {}, vehicle_id: {} };
  const client = {
    async execute(model, method) {
      if (method === "fields_get") return fields;
      if (model === "sale.order") return [{ id: 10, name: "S001", state: "sale", is_service_order: true }];
      if (model === "sale.order.line") return [];
      return [];
    },
  };
  const result = await readOdooServiceHistory(client, {
    updatedSince: "2026-08-03T09:00:00Z",
    reconcile: true,
  });
  assert.deepEqual(result.orders.map((order) => order.id), [10]);
  assert.deepEqual(result.activeOrderIds, ["10"]);
  assert.deepEqual(result.inactiveOrderIds, []);
});

test("Odoo history fails closed instead of importing ordinary sales when the service-order flag is unavailable", async () => {
  const client = {
    async execute(model, method) {
      if (method === "fields_get") return { id: {}, state: {}, order_id: {} };
      assert.fail(`history must not read ${model} without a service-order discriminator`);
    },
  };
  await assert.rejects(
    () => readOdooServiceHistory(client),
    /missing the required is_service_order service-order field/,
  );
});

test("Odoo history defensively excludes ordinary sales from a mixed provider response", async () => {
  const fields = { id: {}, name: {}, state: {}, order_id: {}, is_service_order: {}, vehicle_id: {} };
  const client = {
    async execute(model, method) {
      if (method === "fields_get") return fields;
      if (model === "sale.order") return [
        { id: 10, name: "S001", state: "sale", is_service_order: false },
        { id: 11, name: "SR001", state: "sale", is_service_order: true },
      ];
      if (model === "sale.order.line") return [];
      return [];
    },
  };
  const result = await readOdooServiceHistory(client, { reconcile: true });
  assert.deepEqual(result.orders.map((order) => order.id), [11]);
  assert.deepEqual(result.activeOrderIds, ["11"]);
  assert.deepEqual(result.inactiveOrderIds, []);
});

test("inventory sync isolates optional service-history permission failures", async () => {
  const source = await readFile(new URL("./odoo.admin.service.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /searchReadAll\("stock\.quant"/);
  assert.match(source, /searchReadAll\("product\.product"/);
  assert.match(source, /const inventoryResult = await importOdooInventory[\s\S]*try \{[\s\S]*readOdooServiceHistory/);
  assert.match(source, /catch \{[\s\S]*\.\.\.inventoryResult[\s\S]*historyWarning:/);
  assert.match(source, /markServiceHistorySyncSucceeded[\s\S]*providerWatermark: syncStartedAt/);
  assert.match(source, /const syncStartedAt = new Date\(\)[\s\S]*markServiceHistorySyncAttempted\(companyId, "odoo", syncStartedAt\)/);
  assert.match(source, /catch \{[\s\S]*markServiceHistorySyncFailed[\s\S]*ODOO_SERVICE_HISTORY_UNAVAILABLE/);
  assert.match(source, /markServiceHistorySyncFailed\(companyId, "odoo", \{[\s\S]*attemptedAt: syncStartedAt/);
  assert.match(source, /HISTORY_RECONCILE_INTERVAL_MS/);
});

test("Odoo commitment date remains scheduled and is never imported as completed", async () => {
  const repository = await readFile(new URL("./odoo.admin.repo.js", import.meta.url), "utf8");
  assert.match(repository, /scheduled_at:\s*order\.commitment_date \|\| null/i);
  assert.match(repository, /completed_at:\s*order\.effective_date \|\| null/i);
  assert.doesNotMatch(repository, /completed_at:\s*order\.effective_date \|\| order\.commitment_date/i);
  assert.match(repository, /completion_date_kind:\s*order\.effective_date[\s\S]*"verified_completed"[\s\S]*"scheduled"/i);
  assert.match(repository, /inactiveOrderIds[\s\S]*external_id = any\(\$2::text\[\]\)/i);
});

test("Odoo history schema preserves all lines while materialized relationships remain context only", async () => {
  const migration = await readFile(new URL("../../db/migrations/045_service_repair_history.sql", import.meta.url), "utf8");
  const repository = await readFile(new URL("./odoo.admin.repo.js", import.meta.url), "utf8");
  assert.match(migration, /service_history_lines_order_sequence_idx/i);
  assert.match(repository, /relationship:\s*"same_order_context"/i);
  assert.match(repository, /'context'/i);
  assert.match(repository, /from odoo_vehicles[\s\S]*mapping_status = 'mapped'[\s\S]*app_asset_id is not null/i);
  assert.match(repository, /asset_external_id:\s*assetExternalId/i);
  assert.match(repository, /asset_id = excluded\.asset_id/i);
  assert.match(repository, /normalized_part_number, asset_id, repair_text/i);
  assert.doesNotMatch(repository, /lineDistance[^\n]+confirmed/i);
});
