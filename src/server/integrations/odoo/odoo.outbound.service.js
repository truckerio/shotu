import { createOdooClient } from "./odoo.client.js";
import { readOdooConfiguration } from "./odoo.admin.repo.js";
import {
  claimOdooOutboundOrder,
  readExportedOdooOutboundOrder,
  readOdooOutboundReadiness,
  recordOdooOutboundFailure,
  recordOdooOutboundSuccess,
  saveOdooWorkorderPreparation,
  updateOdooOutboundPayload,
} from "./odoo.outbound.repo.js";
import {
  createOdooDraftSchema,
  odooOutboundWorkorderIdSchema,
  prepareOdooWorkorderSchema,
} from "./odoo.outbound.schemas.js";
import { IntegrationHttpError } from "../core/integration-errors.js";

export class OdooOutboundError extends IntegrationHttpError {
  constructor(code, message, statusCode = 422, details = undefined) {
    super(statusCode, code, message, details);
    this.name = "OdooOutboundError";
  }
}

export function stableOdooWorkorderMarker(companyId, workorderId) {
  return `WO:${companyId}:${workorderId}`;
}

function blocker(code, message, field) {
  return { code, message, ...(field ? { field } : {}) };
}

function decimal(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function publicIdentity(value) {
  return value?.externalId ? {
    externalId: String(value.externalId),
    displayName: String(value.displayName || ""),
  } : null;
}

export function evaluateOdooOutboundReadiness(data, { configured }) {
  const blockers = [];
  const workorder = data?.workorder || null;
  const preparation = data?.preparation || null;
  const vehicle = data?.vehicle || null;
  const warehouse = data?.warehouse || null;
  const labor = data?.labor || null;
  const parts = Array.isArray(data?.parts) ? data.parts : [];
  const laborHours = decimal(preparation?.laborHours);
  const customerExternalId = preparation?.customerExternalId || vehicle?.customerExternalId || "";
  const customerDisplayName = preparation?.customerExternalId
    ? preparation.customerDisplayName || ""
    : vehicle?.customerDisplayName || "";
  const customerSource = preparation?.customerExternalId ? "override" : "vehicle";

  if (!configured) blockers.push(blocker("ODOO_CONNECTION_MISSING", "Configure the Odoo connection before creating a draft."));
  if (!workorder) blockers.push(blocker("ODOO_WORKORDER_NOT_FOUND", "Workorder was not found."));
  else if (workorder.status !== "closed") {
    blockers.push(blocker("ODOO_WORKORDER_NOT_APPROVED", "Office approval is required before creating an Odoo draft."));
  }
  if (workorder && workorder.partsValid === false) {
    blockers.push(blocker("ODOO_PARTS_INVALID", "Workorder parts data is malformed and must be corrected before Odoo creation.", "parts"));
  }
  if (!vehicle?.externalId || vehicle.mappingStatus !== "mapped" || vehicle.active === false) {
    blockers.push(blocker("ODOO_VEHICLE_UNMAPPED", "Map this unit to an active Odoo vehicle.", "vehicle"));
  }
  if (!warehouse?.externalId || warehouse.active === false) {
    blockers.push(blocker("ODOO_WAREHOUSE_UNMAPPED", "Map this workorder location to an active Odoo warehouse.", "warehouse"));
  }
  if (!customerExternalId) {
    blockers.push(blocker("ODOO_CUSTOMER_MISSING", "Select an Odoo customer for this service order.", "customerExternalId"));
  }
  if (!laborHours || laborHours <= 0 || Math.round(laborHours * 100) !== laborHours * 100) {
    blockers.push(blocker("ODOO_LABOR_INVALID", "Enter actual labor hours with no more than two decimal places.", "laborHours"));
  }
  if (!String(workorder?.workPerformed || "").trim()) {
    blockers.push(blocker("ODOO_WORK_PERFORMED_MISSING", "Work performed is required for the labor description.", "workPerformed"));
  }
  if (!labor?.productExternalId || labor.active === false || labor.uomCode !== "hr") {
    blockers.push(blocker("ODOO_LABOR_PRODUCT_INVALID", "Configure an active Odoo labor product using Hours.", "laborProduct"));
  }
  for (const part of parts) {
    if (!part.productExternalId || part.productActive === false) {
      blockers.push(blocker(
        "ODOO_PART_UNMAPPED",
        `Map part ${part.partNumber || part.lineIndex + 1} to an active Odoo product.`,
        `parts.${part.lineIndex}`,
      ));
    }
    if (!decimal(part.odooQuantity) || decimal(part.odooQuantity) <= 0) {
      blockers.push(blocker(
        "ODOO_PART_QUANTITY_INVALID",
        `Part ${part.partNumber || part.lineIndex + 1} does not have a valid Odoo quantity conversion.`,
        `parts.${part.lineIndex}.quantity`,
      ));
    }
  }

  return {
    ready: blockers.length === 0,
    blockers,
    workorder: workorder ? {
      id: workorder.id,
      serial: workorder.serial || "",
      status: workorder.status,
      updatedAt: workorder.updatedAt || null,
    } : null,
    vehicle: publicIdentity(vehicle),
    warehouse: publicIdentity(warehouse),
    customer: customerExternalId ? {
      externalId: String(customerExternalId),
      displayName: String(customerDisplayName),
      source: customerSource,
    } : null,
    labor: {
      productExternalId: String(labor?.productExternalId || ""),
      uom: labor?.uomCode === "hr" ? "hr" : "",
      hours: laborHours,
    },
    parts: parts.map((part) => ({
      lineIndex: part.lineIndex,
      partNumber: part.partNumber || "",
      quantity: decimal(part.odooQuantity),
      uomCode: part.odooUomCode || part.uomCode || "",
      productExternalId: String(part.productExternalId || ""),
      productName: part.productName || "",
    })),
  };
}

export async function prepareOdooWorkorder({ companyId, workorderId, userId, input }, dependencies = {}) {
  const parsedWorkorderId = odooOutboundWorkorderIdSchema.parse(workorderId);
  const parsed = prepareOdooWorkorderSchema.parse(input);
  const savePreparation = dependencies.savePreparation || saveOdooWorkorderPreparation;
  const readConfiguration = dependencies.readConfiguration || readOdooConfiguration;
  let customerDisplayName = "";
  if (parsed.customerExternalId) {
    const configuration = await readConfiguration(companyId);
    if (!configuration) {
      throw new OdooOutboundError("ODOO_CONNECTION_MISSING", "Configure the Odoo connection before selecting a customer.");
    }
    const createClient = dependencies.createClient || createOdooClient;
    const client = createClient(configuration);
    const rows = await client.execute("res.partner", "read", [[Number(parsed.customerExternalId)]], {
      fields: ["id", "display_name", "active"],
    });
    const customer = rows[0];
    if (!customer || customer.active === false) {
      throw new OdooOutboundError("ODOO_CUSTOMER_MISSING", "Select an active Odoo customer.");
    }
    customerDisplayName = String(customer.display_name || "");
  }
  return savePreparation(companyId, parsedWorkorderId, {
    laborHours: parsed.laborHours,
    customerExternalId: parsed.customerExternalId || null,
    customerDisplayName,
    userId,
  });
}

async function readinessContext({ companyId, workorderId }, dependencies) {
  const readReadiness = dependencies.readReadiness || readOdooOutboundReadiness;
  const readConfiguration = dependencies.readConfiguration || readOdooConfiguration;
  const [data, configuration] = await Promise.all([
    readReadiness(companyId, workorderId),
    readConfiguration(companyId),
  ]);
  return { data, configuration };
}

export async function odooWorkorderReadiness({ companyId, workorderId }, dependencies = {}) {
  const parsedWorkorderId = odooOutboundWorkorderIdSchema.parse(workorderId);
  const { data, configuration } = await readinessContext({ companyId, workorderId: parsedWorkorderId }, dependencies);
  const readiness = evaluateOdooOutboundReadiness(data, { configured: Boolean(configuration) });
  if (readiness.ready) {
    const createClient = dependencies.createClient || createOdooClient;
    try {
      await requireCompatibleSaleOrder(createClient(configuration), data.settings || {});
    } catch (error) {
      if (error?.code !== "ODOO_MODEL_INCOMPATIBLE") throw error;
      return {
        ...readiness,
        ready: false,
        blockers: [blocker(error.code, error.message, "odooModel")],
      };
    }
  }
  return readiness;
}

function numericExternalId(value, field) {
  const text = String(value || "");
  if (!/^\d+$/.test(text)) throw new OdooOutboundError("ODOO_MAPPING_INVALID", `Odoo ${field} mapping is invalid.`);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new OdooOutboundError("ODOO_MAPPING_INVALID", `Odoo ${field} mapping is invalid.`);
  }
  return number;
}

function productDetail(products, externalId) {
  const product = products.get(String(externalId));
  if (!product) throw new OdooOutboundError("ODOO_PART_UNMAPPED", "An Odoo product could not be read.");
  const uomId = Array.isArray(product.uom_id) ? product.uom_id[0] : product.uom_id;
  if (!uomId) throw new OdooOutboundError("ODOO_PART_UOM_INVALID", "An Odoo product is missing its unit of measure.");
  return {
    id: numericExternalId(product.id, "product"),
    name: String(product.display_name || product.name || "Product").trim(),
    uomId: numericExternalId(uomId, "product unit"),
    priceUnit: Number(product.lst_price ?? product.list_price ?? 0),
    customerLead: Math.max(0, Number(product.sale_delay) || 0),
  };
}

function relationName(value) {
  return Array.isArray(value) ? String(value[1] || "").trim() : "";
}

function requireCurrentProductUoms(data, products) {
  const labor = productDetail(products, data.labor.productExternalId);
  if (String(labor.uomId) !== String(data.labor.uomExternalId || "")) {
    throw new OdooOutboundError(
      "ODOO_LABOR_PRODUCT_INVALID",
      "The Odoo labor product unit changed. Rediscover products and review the labor mapping.",
    );
  }
  for (const part of data.parts || []) {
    const product = products.get(String(part.productExternalId));
    const expectedName = String(part.expectedOdooUomName || "").trim().toLowerCase();
    if (!expectedName || relationName(product?.uom_id).toLowerCase() !== expectedName) {
      throw new OdooOutboundError(
        "ODOO_PART_UOM_INVALID",
        `The Odoo unit for part ${part.partNumber || part.lineIndex + 1} changed. Rediscover products and review the mapping.`,
      );
    }
  }
}

function orderLine({ sequence, product, quantity, name }) {
  return [0, 0, {
    sequence,
    product_id: product.id,
    product_uom: product.uomId,
    product_uom_qty: Number(quantity),
    name: String(name || product.name).trim(),
    price_unit: product.priceUnit,
    customer_lead: product.customerLead,
  }];
}

export function buildOdooDraftPayload(data, marker, { products = new Map(), addresses = {} } = {}) {
  const workorder = data.workorder;
  const preparation = data.preparation;
  const vehicle = data.vehicle;
  const warehouse = data.warehouse;
  const labor = data.labor;
  const customerExternalId = preparation.customerExternalId || vehicle.customerExternalId;
  const customerId = numericExternalId(customerExternalId, "customer");
  const laborName = String(labor.productName || labor.displayName || "LABOR HOURS").trim();
  const workPerformed = String(workorder.workPerformed || "").trim();
  const laborProduct = productDetail(products, labor.productExternalId);
  const goods = (data.parts || []).map((part, index) => orderLine({
    sequence: 20 + (index * 10),
    product: productDetail(products, part.productExternalId),
    quantity: part.odooQuantity,
    name: part.productName || part.partNumber || "Part",
  }));
  const settings = data.settings || {};
  return {
    partner_id: customerId,
    partner_invoice_id: numericExternalId(addresses.invoice || customerId, "invoice customer"),
    partner_shipping_id: numericExternalId(addresses.delivery || customerId, "delivery customer"),
    [settings.warehouseField || "warehouse_id"]: numericExternalId(warehouse.externalId, "warehouse"),
    [settings.vehicleField || "vehicle_id"]: numericExternalId(vehicle.externalId, "vehicle"),
    [settings.serviceFlagField || "is_service_order"]: true,
    [settings.stableMarkerField || "client_order_ref"]: marker,
    origin: String(workorder.serial || "").slice(0, 200),
    order_line: [orderLine({
      sequence: 10,
      product: laborProduct,
      quantity: preparation.laborHours,
      name: `${laborName}\n${workPerformed}`,
    }), ...goods],
  };
}

async function requireCompatibleSaleOrder(client, settings) {
  const model = settings.orderModel || "sale.order";
  const fields = await client.execute(model, "fields_get", [], { attributes: ["type", "relation"] });
  const required = [
    "partner_id", "partner_invoice_id", "partner_shipping_id", "origin", "order_line",
    settings.warehouseField || "warehouse_id",
    settings.vehicleField || "vehicle_id",
    settings.serviceFlagField || "is_service_order",
    settings.stableMarkerField || "client_order_ref",
  ];
  const missing = required.filter((field) => !Object.hasOwn(fields || {}, field));
  if (missing.length) {
    throw new OdooOutboundError(
      "ODOO_MODEL_INCOMPATIBLE",
      "Odoo sale orders do not expose the required service-order fields.",
      422,
      { missingFields: missing },
    );
  }
}

async function findDraftByMarker(client, marker, settings) {
  const model = settings.orderModel || "sale.order";
  const markerField = settings.stableMarkerField || "client_order_ref";
  const orders = await client.execute(model, "search_read", [[[markerField, "=", marker]]], {
    fields: ["id", "name", "state", markerField],
    limit: 2,
    order: "id asc",
  });
  if (orders.length > 1) {
    throw new OdooOutboundError("ODOO_DRAFT_CONFLICT", "More than one Odoo order uses this workorder marker.", 409);
  }
  if (orders[0] && orders[0].state !== "draft") {
    throw new OdooOutboundError("ODOO_DRAFT_CONFLICT", "The existing Odoo service order is no longer a draft.", 409);
  }
  return orders[0] || null;
}

async function readCreatedDraft(client, externalId, settings) {
  const model = settings.orderModel || "sale.order";
  const markerField = settings.stableMarkerField || "client_order_ref";
  const rows = await client.execute(model, "read", [[externalId]], {
    fields: ["id", "name", "state", markerField],
  });
  const order = rows[0];
  if (!order || order.state !== "draft") {
    throw new OdooOutboundError("ODOO_DRAFT_NOT_CREATED", "Odoo did not return a draft service order.", 502);
  }
  return order;
}

function safeProviderMessage(error) {
  if (error instanceof OdooOutboundError) return error.message;
  return String(error?.message || "Odoo draft creation failed.")
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, "https://")
    .replace(/(api[_ -]?key|password|token)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 1000);
}

export async function createOdooWorkorderDraft({
  companyId,
  workorderId,
  userId,
  requestId = null,
  input = {},
}, dependencies = {}) {
  const parsedWorkorderId = odooOutboundWorkorderIdSchema.parse(workorderId);
  createOdooDraftSchema.parse(input);
  const readExported = dependencies.readExported || readExportedOdooOutboundOrder;
  const existingExport = await readExported(companyId, parsedWorkorderId);
  if (existingExport?.externalId) {
    return {
      workorderId: parsedWorkorderId,
      status: "draft",
      externalId: String(existingExport.externalId),
      serviceOrderNo: existingExport.serviceOrderNo || "",
      replayed: true,
    };
  }
  const { data, configuration } = await readinessContext({ companyId, workorderId: parsedWorkorderId }, dependencies);
  const readiness = evaluateOdooOutboundReadiness(data, { configured: Boolean(configuration) });
  if (!readiness.ready) {
    throw new OdooOutboundError(readiness.blockers[0].code, readiness.blockers[0].message, 422, {
      blockers: readiness.blockers,
    });
  }
  if (input.expectedUpdatedAt && input.expectedUpdatedAt !== new Date(data.workorder.updatedAt).toISOString()) {
    throw new OdooOutboundError("ODOO_WORKORDER_STALE", "The workorder changed after readiness was reviewed.", 409);
  }

  const marker = stableOdooWorkorderMarker(companyId, parsedWorkorderId);
  const claimDraft = dependencies.claimDraft || claimOdooOutboundOrder;
  const updatePayload = dependencies.updatePayload || updateOdooOutboundPayload;
  const recordSuccess = dependencies.recordSuccess || recordOdooOutboundSuccess;
  const recordFailure = dependencies.recordFailure || recordOdooOutboundFailure;
  const claim = await claimDraft({
    companyId,
    workorderId: parsedWorkorderId,
    marker,
    payloadSnapshot: { marker, readiness },
    userId,
    requestId,
  });
  if (claim.replayed) {
    return {
      workorderId: parsedWorkorderId,
      status: "draft",
      externalId: String(claim.externalId),
      serviceOrderNo: claim.serviceOrderNo || "",
      replayed: true,
    };
  }
  if (!claim.claimed) {
    if (claim.conflict) {
      throw new OdooOutboundError("ODOO_DRAFT_CONFLICT", "Odoo draft creation requires manual reconciliation.", 409);
    }
    throw new OdooOutboundError("ODOO_DRAFT_IN_PROGRESS", "Odoo draft creation is already in progress.", 409);
  }

  try {
    const createClient = dependencies.createClient || createOdooClient;
    const client = createClient(configuration);
    const settings = data.settings || {};
    await requireCompatibleSaleOrder(client, settings);
    let order = await findDraftByMarker(client, marker, settings);
    const replayed = Boolean(order);
    if (!order) {
      const customerId = numericExternalId(data.preparation.customerExternalId || data.vehicle.customerExternalId, "customer");
      const productIds = [...new Set([
        data.labor.productExternalId,
        ...(data.parts || []).map((part) => part.productExternalId),
      ].map((value) => numericExternalId(value, "product")))];
      const [addresses, productRows] = await Promise.all([
        client.execute("res.partner", "address_get", [[customerId], ["invoice", "delivery"]]),
        client.execute("product.product", "read", [productIds], {
          fields: ["id", "display_name", "name", "active", "uom_id", "lst_price", "list_price", "sale_delay"],
        }),
      ]);
      if (productRows.length !== productIds.length || productRows.some((product) => product.active === false)) {
        throw new OdooOutboundError("ODOO_PART_UNMAPPED", "One or more mapped Odoo products are missing or inactive.");
      }
      const products = new Map(productRows.map((product) => [String(product.id), product]));
      requireCurrentProductUoms(data, products);
      const payload = buildOdooDraftPayload(data, marker, { products, addresses: addresses || {} });
      await updatePayload(companyId, parsedWorkorderId, payload);
      let createdId;
      try {
        createdId = await client.execute(settings.orderModel || "sale.order", "create", [payload]);
      } catch (error) {
        if (["ODOO_CONNECTION_TIMEOUT", "ODOO_TRANSPORT_ERROR"].includes(error?.code)) {
          throw new OdooOutboundError(
            "ODOO_CREATE_RESULT_UNKNOWN",
            "Odoo did not confirm whether the draft was created. Reconcile the workorder marker in Odoo before retrying.",
            409,
          );
        }
        throw error;
      }
      order = await readCreatedDraft(client, createdId, settings);
    }
    await recordSuccess({
      companyId,
      workorderId: parsedWorkorderId,
      externalId: String(order.id),
      serviceOrderNo: String(order.name || ""),
      marker,
      userId,
      requestId,
      replayed,
    });
    return {
      workorderId: parsedWorkorderId,
      status: "draft",
      externalId: String(order.id),
      serviceOrderNo: String(order.name || ""),
      replayed,
    };
  } catch (error) {
    await recordFailure({
      companyId,
      workorderId: parsedWorkorderId,
      code: error.code || "ODOO_DRAFT_FAILED",
      message: safeProviderMessage(error),
      userId,
      requestId,
    }).catch(() => {});
    if (error instanceof OdooOutboundError) throw error;
    throw new OdooOutboundError("ODOO_DRAFT_FAILED", safeProviderMessage(error), 502);
  }
}
