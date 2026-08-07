import { createOdooClient } from "./odoo.client.js";
import {
  importOdooInventory,
  importOdooServiceHistory,
  listOdooOutboundAdminReadiness,
  listOdooOutboundProviderVehicles,
  listOdooOutboundVehicleMappings,
  listOdooLocationMappings,
  odooAdminStatus,
  readOdooConfiguration,
  saveOdooConfiguration,
  setOdooOutboundLaborProduct,
  setOdooOutboundVehicleMapping,
  setOdooOutboundWarehouseMapping,
  setOdooLocationMapping,
  upsertOdooOutboundDiscovery,
  upsertDiscoveredOdooLocations,
} from "./odoo.admin.repo.js";
import {
  markServiceHistorySyncSucceeded,
  readServiceHistorySyncState,
} from "../../db/repositories/service-history.repo.js";
import { IntegrationHttpError } from "../core/integration-errors.js";

const HISTORY_PAGE_SIZE = 500;
const ORDER_ID_BATCH_SIZE = 200;
const PRODUCT_ID_BATCH_SIZE = 500;
const MAX_HISTORY_ORDERS = 100_000;
const MAX_HISTORY_LINES = 500_000;
const MAX_HISTORY_PRODUCTS = 100_000;
const ELIGIBLE_HISTORY_STATES = new Set(["sale", "done"]);
const HISTORY_RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

async function supportedFields(client, model, candidates) {
  const definitions = await client.execute(model, "fields_get", [], { attributes: ["type", "relation"] });
  return candidates.filter((field) => Object.hasOwn(definitions || {}, field));
}

function odooDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function batches(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function pagedSearchRead(client, model, domain, fields, maxRecords) {
  const records = [];
  let lastId = 0;
  while (true) {
    const remaining = maxRecords + 1 - records.length;
    const page = await client.execute(model, "search_read", [[...domain, ["id", ">", lastId]]], {
      fields,
      limit: Math.max(1, Math.min(HISTORY_PAGE_SIZE, remaining)),
      order: "id asc",
    });
    records.push(...page);
    if (records.length > maxRecords) {
      throw new Error(`Odoo ${model} history sync exceeded the ${maxRecords}-record safety limit.`);
    }
    if (page.length < HISTORY_PAGE_SIZE) return records;
    const nextId = Number(page.at(-1)?.id);
    if (!Number.isFinite(nextId) || nextId <= lastId) {
      throw new Error(`Odoo ${model} history pagination did not advance.`);
    }
    lastId = nextId;
  }
}

export async function readOdooServiceHistory(client, { updatedSince = null, reconcile = false } = {}) {
  const orderFields = await supportedFields(client, "sale.order", [
    "id", "name", "state", "date_order", "effective_date", "commitment_date", "write_date",
  ]);
  const lineFields = await supportedFields(client, "sale.order.line", [
    "id", "order_id", "sequence", "display_type", "product_id", "name",
    "product_uom_qty", "product_uom", "write_date",
  ]);
  const fullHistoryRead = !updatedSince || reconcile;
  let orders;
  if (fullHistoryRead) {
    orders = await pagedSearchRead(
      client,
      "sale.order",
      [["state", "in", [...ELIGIBLE_HISTORY_STATES]]],
      orderFields,
      MAX_HISTORY_ORDERS,
    );
  } else {
    const overlap = odooDateTime(new Date(new Date(updatedSince).valueOf() - 5 * 60_000));
    const changedOrders = overlap && orderFields.includes("write_date")
      ? await pagedSearchRead(client, "sale.order", [["write_date", ">=", overlap]], orderFields, MAX_HISTORY_ORDERS)
      : [];
    const changedLines = overlap && lineFields.includes("write_date")
      ? await pagedSearchRead(
        client,
        "sale.order.line",
        [["write_date", ">=", overlap]],
        ["id", "order_id", "write_date"],
        MAX_HISTORY_LINES,
      )
      : [];
    const affectedOrderIds = [...new Set([
      ...changedOrders.map((order) => order.id),
      ...changedLines.map((line) => Array.isArray(line.order_id) ? line.order_id[0] : line.order_id),
    ].filter(Boolean))];
    orders = [];
    for (const orderIds of batches(affectedOrderIds, ORDER_ID_BATCH_SIZE)) {
      orders.push(...await pagedSearchRead(
        client,
        "sale.order",
        [["id", "in", orderIds], ["state", "in", [...ELIGIBLE_HISTORY_STATES]]],
        orderFields,
        MAX_HISTORY_ORDERS - orders.length,
      ));
    }
  }
  const activeOrderIds = fullHistoryRead ? orders.map((order) => String(order.id)) : null;
  if (!orders.length) return { orders: [], lines: [], products: [], activeOrderIds };

  const lines = [];
  for (const orderIds of batches(orders.map((order) => order.id), ORDER_ID_BATCH_SIZE)) {
    lines.push(...await pagedSearchRead(
      client,
      "sale.order.line",
      [["order_id", "in", orderIds]],
      lineFields,
      MAX_HISTORY_LINES - lines.length,
    ));
  }
  const productIds = [...new Set(lines.map((line) => Array.isArray(line.product_id) ? line.product_id[0] : line.product_id).filter(Boolean))];
  if (!productIds.length) return { orders, lines, products: [], activeOrderIds };
  const productFields = await supportedFields(client, "product.product", [
    "id", "default_code", "barcode", "name", "type", "detailed_type",
  ]);
  const products = [];
  for (const productIdBatch of batches(productIds, PRODUCT_ID_BATCH_SIZE)) {
    products.push(...await pagedSearchRead(
      client,
      "product.product",
      [["id", "in", productIdBatch]],
      productFields,
      MAX_HISTORY_PRODUCTS - products.length,
    ));
  }
  return { orders, lines, products, activeOrderIds };
}

async function configuredClient(companyId) {
  const configuration = await readOdooConfiguration(companyId);
  if (!configuration) throw new Error("Configure the Odoo.sh connection first.");
  return createOdooClient(configuration);
}

export async function configureOdoo(companyId, configuration) {
  const client = createOdooClient(configuration);
  await client.authenticate();
  await saveOdooConfiguration(companyId, configuration);
  return odooAdminStatus(companyId);
}

export async function testOdoo(companyId) {
  const client = await configuredClient(companyId);
  const uid = await client.authenticate();
  return { ok: true, uid };
}

export async function discoverOdooLocations(companyId) {
  const client = await configuredClient(companyId);
  const records = await client.searchReadAll("stock.location", [["usage", "=", "internal"]], [
    "id", "name", "complete_name", "display_name", "active", "write_date",
  ]);
  await upsertDiscoveredOdooLocations(companyId, records);
  return listOdooLocationMappings(companyId);
}

export async function discoverOdooOutbound(companyId, actor = {}) {
  const client = await configuredClient(companyId);
  const [vehicleFields, warehouseFields, productFields, uomFields] = await Promise.all([
    supportedFields(client, "fleet.vehicle", [
      "id", "display_name", "name", "unit_number", "vin", "vin_sn",
      "license_plate", "partner_id", "active", "write_date",
    ]),
    supportedFields(client, "stock.warehouse", [
      "id", "display_name", "name", "code", "lot_stock_id", "active", "write_date",
    ]),
    supportedFields(client, "product.product", [
      "id", "default_code", "display_name", "name", "type", "detailed_type",
      "uom_id", "active", "write_date",
    ]),
    supportedFields(client, "uom.uom", ["id", "name", "category_id", "active", "write_date"]),
  ]);
  const requiredOrderFields = await supportedFields(client, "sale.order", [
    "vehicle_id", "is_service_order", "warehouse_id", "client_order_ref", "order_line",
  ]);
  if (!["vehicle_id", "is_service_order", "warehouse_id", "client_order_ref", "order_line"]
    .every((field) => requiredOrderFields.includes(field))) {
    throw new IntegrationHttpError(
      422,
      "ODOO_MODEL_INCOMPATIBLE",
      "Odoo sale orders do not expose the required service-order fields.",
    );
  }
  const productTypeField = productFields.includes("detailed_type")
    ? "detailed_type"
    : productFields.includes("type") ? "type" : "";
  if (!productTypeField) {
    throw new IntegrationHttpError(
      422,
      "ODOO_MODEL_INCOMPATIBLE",
      "Odoo products do not expose a supported service-product type field.",
    );
  }
  const [vehicles, warehouses, serviceProducts] = await Promise.all([
    client.searchReadAll("fleet.vehicle", [["active", "=", true]], vehicleFields),
    client.searchReadAll("stock.warehouse", [], warehouseFields),
    client.searchReadAll("product.product", [
      ["active", "=", true],
      [productTypeField, "=", "service"],
    ], productFields),
  ]);
  const uomIds = [...new Set(serviceProducts.map((product) => Array.isArray(product.uom_id)
    ? product.uom_id[0]
    : product.uom_id).filter(Boolean))];
  const uoms = uomIds.length
    ? await client.searchReadAll("uom.uom", [["id", "in", uomIds]], uomFields)
    : [];
  const discoveryResult = await upsertOdooOutboundDiscovery(companyId, { vehicles, warehouses, serviceProducts, uoms, actor });
  const readiness = await listOdooOutboundAdminReadiness(companyId);
  return {
    ...readiness,
    discovery: discoveryResult,
    vehicles: {
      ...readiness.vehicles,
      autoMatchedCount: discoveryResult.vehicleAutoMatchedCount || 0,
    },
  };
}

export async function odooOutboundReadiness(companyId) {
  return listOdooOutboundAdminReadiness(companyId);
}

export async function odooOutboundVehicles(companyId, input) {
  return listOdooOutboundVehicleMappings(companyId, input);
}

export async function odooOutboundProviderVehicles(companyId, input) {
  return listOdooOutboundProviderVehicles(companyId, input);
}

export async function configureOdooOutboundVehicle(companyId, assetId, input, actor) {
  return setOdooOutboundVehicleMapping(companyId, assetId, input, actor);
}

export async function configureOdooOutboundWarehouse(companyId, locationId, input, actor) {
  await setOdooOutboundWarehouseMapping(companyId, locationId, input, actor);
  return listOdooOutboundAdminReadiness(companyId);
}

export async function configureOdooOutboundLaborProduct(companyId, input, actor) {
  await setOdooOutboundLaborProduct(companyId, input.productExternalId, actor);
  return listOdooOutboundAdminReadiness(companyId);
}

export async function syncOdooPartsAndInventory(companyId) {
  const client = await configuredClient(companyId);
  await discoverOdooLocations(companyId);
  const [products, quants] = await Promise.all([
    client.searchReadAll("product.product", [["active", "=", true]], [
      "id", "default_code", "barcode", "name", "categ_id", "uom_id", "write_date",
    ]),
    client.searchReadAll("stock.quant", [["location_id.usage", "=", "internal"]], [
      "id", "product_id", "location_id", "quantity", "reserved_quantity", "write_date",
    ]),
  ]);
  const inventoryResult = await importOdooInventory(companyId, { products, quants });
  try {
    const syncStartedAt = new Date();
    const syncState = await readServiceHistorySyncState(companyId, "odoo");
    const lastReconciledAt = syncState.lastReconciledAt ? new Date(syncState.lastReconciledAt) : null;
    const reconcile = !lastReconciledAt
      || Number.isNaN(lastReconciledAt.valueOf())
      || syncStartedAt.valueOf() - lastReconciledAt.valueOf() >= HISTORY_RECONCILE_INTERVAL_MS;
    const history = await readOdooServiceHistory(client, {
      updatedSince: syncState.providerWatermark,
      reconcile,
    });
    const historyResult = await importOdooServiceHistory(companyId, history);
    await markServiceHistorySyncSucceeded(companyId, "odoo", {
      providerWatermark: syncStartedAt,
      reconciled: reconcile,
    });
    return { ...inventoryResult, ...historyResult, historyWarning: "" };
  } catch {
    return {
      ...inventoryResult,
      historyOrderCount: 0,
      historyLineCount: 0,
      historyContextCount: 0,
      historyRemovedCount: 0,
      historyWarning: "Parts and inventory synced, but service history could not be read. Verify read-only Sales permissions in Odoo.",
    };
  }
}

export { listOdooLocationMappings, odooAdminStatus, setOdooLocationMapping };
