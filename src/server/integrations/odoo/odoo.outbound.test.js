import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  OdooOutboundError,
  buildOdooDraftPayload,
  createOdooWorkorderDraft,
  evaluateOdooOutboundReadiness,
  normalizeOdooOdometer,
  odooWorkorderReadiness,
  prepareOdooWorkorder,
  stableOdooWorkorderMarker,
} from "./odoo.outbound.service.js";
import { prepareOdooWorkorderSchema } from "./odoo.outbound.schemas.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const workorderId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const updatedAt = "2026-08-03T20:00:00.000Z";
const providerConfiguration = {
  baseUrl: "https://protec.example.odoo.com",
  database: "protec",
  apiKey: "server-only",
};

function readyData() {
  return {
    workorder: {
      id: workorderId,
      serial: "WO-1042",
      status: "closed",
      workPerformed: "PUT NEW HUB SEAL, ADJUST BRAKES",
      mileage: "482150",
      updatedAt,
      partsValid: true,
    },
    preparation: {
      id: "44444444-4444-4444-8444-444444444444",
      laborHours: 2.5,
      customerExternalId: null,
      customerDisplayName: "",
    },
    vehicle: {
      externalId: "17968",
      displayName: "Trailer 24",
      mappingStatus: "mapped",
      active: true,
      customerExternalId: "301",
      customerDisplayName: "Long Haul LLC",
    },
    warehouse: { externalId: "28", displayName: "Chino", active: true },
    labor: {
      productExternalId: "85226",
      productName: "[PTR001] LABOR HOURS",
      active: true,
      uomCode: "hr",
      uomExternalId: "4",
    },
    settings: {
      integrationAccountId: "55555555-5555-4555-8555-555555555555",
      orderModel: "sale.order",
      vehicleField: "vehicle_id",
      serviceFlagField: "is_service_order",
      warehouseField: "warehouse_id",
      stableMarkerField: "client_order_ref",
      serviceActionExternalId: "941",
      serviceActionBaseUrl: providerConfiguration.baseUrl,
      serviceActionDatabase: providerConfiguration.database,
    },
    parts: [{
      lineIndex: 0,
      partNumber: "46305",
      uomCode: "pc",
      productExternalId: "46305",
      productActive: true,
      productName: "[46305] TRAILER SEAL",
      odooUomCode: "pc",
      expectedOdooUomName: "Units",
      odooQuantity: 1,
    }],
  };
}

function providerProducts() {
  return new Map([
    ["85226", {
      id: 85226,
      display_name: "[PTR001] LABOR HOURS",
      active: true,
      uom_id: [4, "Hours"],
      lst_price: 150,
      sale_delay: 0,
    }],
    ["46305", {
      id: 46305,
      display_name: "[46305] TRAILER SEAL",
      active: true,
      uom_id: [1, "Each"],
      lst_price: 49.5,
      sale_delay: 1,
    }],
  ]);
}

test("outbound preparation requires positive labor hours with two-decimal precision", () => {
  assert.deepEqual(prepareOdooWorkorderSchema.parse({ laborHours: "2.50" }), {
    laborHours: 2.5,
  });
  assert.equal(prepareOdooWorkorderSchema.safeParse({ laborHours: 0 }).success, false);
  assert.equal(prepareOdooWorkorderSchema.safeParse({ laborHours: 1.234 }).success, false);
  assert.equal(prepareOdooWorkorderSchema.safeParse({ laborHours: 10_000 }).success, false);
  assert.equal(prepareOdooWorkorderSchema.safeParse({ laborHours: 1, customerExternalId: "not-odoo" }).success, false);
});

test("explicit customer override is verified in Odoo before it is saved", async () => {
  const calls = [];
  const result = await prepareOdooWorkorder({
    companyId,
    workorderId,
    userId,
    input: { laborHours: 1.25, customerExternalId: "712" },
  }, {
    readConfiguration: async (tenant) => {
      assert.equal(tenant, companyId);
      return { apiKey: "server-only" };
    },
    createClient: () => ({
      execute: async (model, method, args, kwargs) => {
        calls.push({ model, method, args, kwargs });
        return [{ id: 712, display_name: "Override Fleet", active: true }];
      },
    }),
    savePreparation: async (tenant, targetId, input) => ({ tenant, targetId, ...input }),
  });

  assert.deepEqual(calls[0], {
    model: "res.partner",
    method: "read",
    args: [[712]],
    kwargs: { fields: ["id", "display_name", "active"] },
  });
  assert.equal(result.customerExternalId, "712");
  assert.equal(result.customerDisplayName, "Override Fleet");
  assert.equal(result.userId, userId);
});

test("readiness fails closed with stable blocker codes", () => {
  const data = readyData();
  data.workorder.status = "mechanic_done";
  data.vehicle = null;
  data.warehouse = null;
  data.preparation.laborHours = 0;
  data.labor.uomCode = "ea";
  data.parts[0].productExternalId = null;
  const result = evaluateOdooOutboundReadiness(data, { configured: false });
  const codes = result.blockers.map((item) => item.code);
  for (const code of [
    "ODOO_CONNECTION_MISSING",
    "ODOO_WORKORDER_NOT_APPROVED",
    "ODOO_VEHICLE_UNMAPPED",
    "ODOO_WAREHOUSE_UNMAPPED",
    "ODOO_CUSTOMER_MISSING",
    "ODOO_LABOR_INVALID",
    "ODOO_LABOR_PRODUCT_INVALID",
    "ODOO_PART_UNMAPPED",
  ]) assert.ok(codes.includes(code), code);
  assert.equal(result.ready, false);
});

test("readiness blocks malformed stored parts data", () => {
  const data = readyData();
  data.workorder.partsValid = false;
  const result = evaluateOdooOutboundReadiness(data, { configured: true });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => item.code === "ODOO_PARTS_INVALID"));
});

test("workorder mileage normalizes for Odoo and invalid values fail before draft creation", () => {
  assert.equal(normalizeOdooOdometer("482,150 mi"), 482150);
  assert.equal(normalizeOdooOdometer(" 482150.5 "), 482150.5);
  assert.equal(normalizeOdooOdometer(""), null);
  assert.equal(normalizeOdooOdometer("unknown"), null);

  const data = readyData();
  data.workorder.mileage = "unknown";
  const result = evaluateOdooOutboundReadiness(data, { configured: true });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => item.code === "ODOO_ODOMETER_INVALID" && item.field === "mileage"));
});

test("ready status validates the live Odoo service-order model", async () => {
  const readiness = await odooWorkorderReadiness({ companyId, workorderId }, {
    readReadiness: async () => readyData(),
    readConfiguration: async () => providerConfiguration,
    createClient: () => ({
      execute: async () => ({ partner_id: {}, order_line: {} }),
    }),
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.blockers[0].code, "ODOO_MODEL_INCOMPATIBLE");
});

test("readiness accepts equivalent Odoo count-unit labels", async () => {
  const readiness = await odooWorkorderReadiness({ companyId, workorderId }, {
    readReadiness: async () => readyData(),
    readConfiguration: async () => providerConfiguration,
    createClient: () => ({
      execute: async (model, method) => {
        if (method === "fields_get") return requiredOrderFields();
        if (model === "product.product" && method === "read") return [...providerProducts().values()];
        throw new Error(`Unexpected ${model}.${method}`);
      },
    }),
  });
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.blockers, []);
  assert.equal(readiness.workorder.odometer, 482150);
});

test("readiness discovers and caches the service-order form action", async () => {
  const data = readyData();
  data.settings.serviceActionExternalId = "";
  let savedAction = "";
  const readiness = await odooWorkorderReadiness({ companyId, workorderId }, {
    readReadiness: async () => data,
    readConfiguration: async () => providerConfiguration,
    saveServiceOrderAction: async (_companyId, navigation) => { savedAction = navigation; },
    createClient: () => ({
      execute: async (model, method) => {
        if (model === "ir.actions.act_window" && method === "search_read") return [{
          id: 941,
          name: "Service Orders",
          res_model: "sale.order",
          view_mode: "list,form",
          domain: "[('is_service_order', '=', True)]",
          context: "{'default_is_service_order': True}",
          views: [[3595, "list"], [3594, "form"]],
        }];
        if (method === "fields_get") return requiredOrderFields();
        if (model === "product.product" && method === "read") return [...providerProducts().values()];
        throw new Error(`Unexpected ${model}.${method}`);
      },
    }),
  });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.serviceOrderActionId, "941");
  assert.deepEqual(savedAction, {
    actionId: "941",
    baseUrl: providerConfiguration.baseUrl,
    database: providerConfiguration.database,
  });
});

test("older workorders without mileage do not require the optional Odoo odometer field", async () => {
  const data = readyData();
  data.workorder.mileage = "";
  const readiness = await odooWorkorderReadiness({ companyId, workorderId }, {
    readReadiness: async () => data,
    readConfiguration: async () => providerConfiguration,
    createClient: () => ({
      execute: async (model, method) => {
        if (method === "fields_get") {
          const fields = requiredOrderFields();
          delete fields.odometer;
          return fields;
        }
        if (model === "product.product" && method === "read") return [...providerProducts().values()];
        throw new Error(`Unexpected ${model}.${method}`);
      },
    }),
  });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.workorder.odometer, null);
});

test("mileage blocks before creation when Odoo odometer is not writable numeric data", async () => {
  const readiness = await odooWorkorderReadiness({ companyId, workorderId }, {
    readReadiness: async () => readyData(),
    readConfiguration: async () => providerConfiguration,
    createClient: () => ({
      execute: async (_model, method) => {
        if (method === "fields_get") {
          return { ...requiredOrderFields(), odometer: { type: "char", readonly: true } };
        }
        throw new Error("Provider products must not load for an incompatible order model.");
      },
    }),
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.blockers[0].code, "ODOO_MODEL_INCOMPATIBLE");
});

test("readiness reports real live Odoo part-unit drift before creation", async () => {
  const products = [...providerProducts().values()];
  products[1] = { ...products[1], uom_id: [12, "Dozen"] };
  const readiness = await odooWorkorderReadiness({ companyId, workorderId }, {
    readReadiness: async () => readyData(),
    readConfiguration: async () => providerConfiguration,
    createClient: () => ({
      execute: async (model, method) => {
        if (method === "fields_get") return requiredOrderFields();
        if (model === "product.product" && method === "read") return products;
        throw new Error(`Unexpected ${model}.${method}`);
      },
    }),
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.blockers[0].code, "ODOO_PART_UOM_INVALID");
  assert.equal(readiness.blockers[0].field, "parts");
});

test("draft payload includes explicit required values and keeps labor before goods", () => {
  const data = readyData();
  const marker = stableOdooWorkorderMarker(companyId, workorderId);
  const payload = buildOdooDraftPayload(data, marker, {
    products: providerProducts(),
    addresses: { invoice: 302, delivery: 303 },
  });
  assert.equal(payload.partner_id, 301);
  assert.equal(payload.partner_invoice_id, 302);
  assert.equal(payload.partner_shipping_id, 303);
  assert.equal(payload.vehicle_id, 17968);
  assert.equal(payload.warehouse_id, 28);
  assert.equal(payload.is_service_order, true);
  assert.equal(payload.client_order_ref, marker);
  assert.equal(payload.odometer, 482150);
  assert.equal(payload.order_line[0][2].sequence, 10);
  assert.equal(payload.order_line[0][2].product_id, 85226);
  assert.equal(payload.order_line[0][2].product_uom, 4);
  assert.equal(payload.order_line[0][2].product_uom_qty, 2.5);
  assert.equal(payload.order_line[0][2].price_unit, 150);
  assert.equal(payload.order_line[0][2].customer_lead, 0);
  assert.equal(payload.order_line[0][2].name, "[PTR001] LABOR HOURS\nPUT NEW HUB SEAL, ADJUST BRAKES");
  assert.equal(payload.order_line[1][2].sequence, 20);
  assert.equal(payload.order_line[1][2].product_id, 46305);
  assert.equal(payload.order_line[1][2].product_uom, 1);
  assert.equal(payload.order_line[1][2].price_unit, 49.5);
  assert.equal(payload.state, undefined);
});

function requiredOrderFields() {
  const fields = Object.fromEntries([
    "partner_id", "partner_invoice_id", "partner_shipping_id", "origin", "order_line",
    "warehouse_id", "vehicle_id", "is_service_order", "client_order_ref", "odometer",
  ].map((field) => [field, {}]));
  fields.odometer = { type: "float", readonly: false };
  return fields;
}

test("draft creation writes one draft without calling confirmation or browser onchange", async () => {
  const calls = [];
  const successes = [];
  const payloads = [];
  const client = {
    async execute(model, method, args, kwargs = {}) {
      calls.push({ model, method, args, kwargs });
      if (method === "fields_get") return requiredOrderFields();
      if (method === "search_read") return [];
      if (model === "res.partner" && method === "address_get") return { invoice: 302, delivery: 303 };
      if (model === "product.product" && method === "read") return [...providerProducts().values()];
      if (model === "sale.order" && method === "create") return 901;
      if (model === "sale.order" && method === "read") {
        return [{
          id: 901,
          name: "S0901",
          state: "draft",
          client_order_ref: stableOdooWorkorderMarker(companyId, workorderId),
          is_service_order: true,
          vehicle_id: [17968, "Trailer 24"],
          warehouse_id: [28, "Chino"],
        }];
      }
      throw new Error(`Unexpected ${model}.${method}`);
    },
  };

  const result = await createOdooWorkorderDraft({
    companyId,
    workorderId,
    userId,
    requestId: "request-1",
    input: { expectedUpdatedAt: updatedAt },
  }, {
    readExported: async () => null,
    readReadiness: async () => readyData(),
    readConfiguration: async () => providerConfiguration,
    claimDraft: async (input) => {
      assert.equal(input.payloadSnapshot.readiness.ready, true);
      return { claimed: true, replayed: false };
    },
    updatePayload: async (_companyId, _workorderId, payload) => payloads.push(payload),
    createClient: () => client,
    recordSuccess: async (input) => successes.push(input),
    recordFailure: async () => assert.fail("successful draft must not record failure"),
  });

  assert.deepEqual(result, {
    workorderId,
    status: "draft",
    externalId: "901",
    serviceOrderNo: "S0901",
    recordUrl: "https://protec.example.odoo.com/web#action=941&id=901&model=sale.order&view_type=form",
    serviceOrderActionId: "941",
    replayed: false,
  });
  assert.equal(payloads.length, 1);
  assert.equal(successes.length, 1);
  assert.equal(calls.filter((call) => call.method === "create").length, 1);
  assert.equal(calls.some((call) => call.method === "action_confirm"), false);
  assert.equal(calls.some((call) => call.method.includes("onchange") || call.method === "default_get"), false);
  const searchCall = calls.find((call) => call.method === "search_read");
  assert.deepEqual(searchCall.args, [[[
    "client_order_ref",
    "=",
    stableOdooWorkorderMarker(companyId, workorderId),
  ]]]);
});

test("retry recovers an existing marked draft without creating another", async () => {
  const calls = [];
  let recorded;
  const result = await createOdooWorkorderDraft({ companyId, workorderId, userId }, {
    readExported: async () => null,
    readReadiness: async () => readyData(),
    readConfiguration: async () => providerConfiguration,
    claimDraft: async () => ({ claimed: true, replayed: false }),
    createClient: () => ({
      execute: async (model, method) => {
        calls.push({ model, method });
        if (method === "fields_get") return requiredOrderFields();
        if (model === "sale.order" && method === "search_read") return [{
          id: 901,
          name: "S0901",
          state: "draft",
          client_order_ref: stableOdooWorkorderMarker(companyId, workorderId),
          is_service_order: true,
          vehicle_id: [17968, "Trailer 24"],
          warehouse_id: [28, "Chino"],
        }];
        if (model === "product.product" && method === "read") return [...providerProducts().values()];
        throw new Error("Recovery must only verify the existing Odoo draft.");
      },
    }),
    recordSuccess: async (input) => { recorded = input; },
    recordFailure: async () => assert.fail("recovery must not fail"),
  });
  assert.equal(result.externalId, "901");
  assert.equal(result.replayed, true);
  assert.equal(recorded.replayed, true);
  assert.equal(calls.some((call) => call.method === "create"), false);
});

test("draft creation fails closed when Odoo drops the service-order vehicle relationship", async () => {
  const failures = [];
  await assert.rejects(
    () => createOdooWorkorderDraft({ companyId, workorderId, userId }, {
      readExported: async () => null,
      readReadiness: async () => readyData(),
      readConfiguration: async () => providerConfiguration,
      claimDraft: async () => ({ claimed: true, replayed: false }),
      updatePayload: async () => {},
      createClient: () => ({
        execute: async (model, method) => {
          if (method === "fields_get") return requiredOrderFields();
          if (model === "sale.order" && method === "search_read") return [];
          if (model === "res.partner" && method === "address_get") return { invoice: 302, delivery: 303 };
          if (model === "product.product" && method === "read") return [...providerProducts().values()];
          if (model === "sale.order" && method === "create") return 901;
          if (model === "sale.order" && method === "read") return [{
            id: 901,
            name: "S0901",
            state: "draft",
            client_order_ref: stableOdooWorkorderMarker(companyId, workorderId),
            is_service_order: true,
            vehicle_id: false,
            warehouse_id: [28, "Chino"],
          }];
          throw new Error(`Unexpected ${model}.${method}`);
        },
      }),
      recordFailure: async (input) => failures.push(input),
    }),
    (error) => error instanceof OdooOutboundError && error.code === "ODOO_DRAFT_MISMATCH",
  );
  assert.equal(failures[0].code, "ODOO_DRAFT_MISMATCH");
});

test("already exported workorders replay before readiness or Odoo calls", async () => {
  const result = await createOdooWorkorderDraft({ companyId, workorderId, userId }, {
    readExported: async () => ({
      externalId: "901",
      serviceOrderNo: "S0901",
      recordUrl: "https://protec.example.odoo.com/web#action=311&id=901&model=sale.order&view_type=form",
      serviceOrderActionId: "311",
    }),
    readReadiness: async () => assert.fail("exported replay must not need readiness"),
    readConfiguration: async () => assert.fail("exported replay must not read credentials"),
    claimDraft: async () => assert.fail("exported replay must not claim a new draft"),
    createClient: () => assert.fail("exported replay must not call Odoo"),
  });

  assert.deepEqual(result, {
    workorderId,
    status: "draft",
    externalId: "901",
    serviceOrderNo: "S0901",
    recordUrl: "https://protec.example.odoo.com/web#action=311&id=901&model=sale.order&view_type=form",
    serviceOrderActionId: "311",
    replayed: true,
  });
});

test("claim-race replay reloads the exported link without calling Odoo", async () => {
  let exportedReads = 0;
  const result = await createOdooWorkorderDraft({ companyId, workorderId, userId }, {
    readExported: async () => {
      exportedReads += 1;
      return exportedReads === 1 ? null : {
        externalId: "901",
        serviceOrderNo: "S0901",
        recordUrl: "https://protec.example.odoo.com/web#action=311&id=901&model=sale.order&view_type=form",
        serviceOrderActionId: "311",
      };
    },
    readReadiness: async () => readyData(),
    readConfiguration: async () => providerConfiguration,
    claimDraft: async () => ({ replayed: true, externalId: "901", serviceOrderNo: "S0901" }),
    createClient: () => assert.fail("claim replay must not call Odoo"),
  });

  assert.equal(exportedReads, 2);
  assert.equal(result.recordUrl, "https://protec.example.odoo.com/web#action=311&id=901&model=sale.order&view_type=form");
  assert.equal(result.serviceOrderActionId, "311");
  assert.equal(result.replayed, true);
});

test("readiness blockers prevent claiming or writing to Odoo", async () => {
  let claimed = false;
  let clientCreated = false;
  const data = readyData();
  data.vehicle = null;
  await assert.rejects(
    () => createOdooWorkorderDraft({ companyId, workorderId, userId }, {
      readExported: async () => null,
      readReadiness: async () => data,
      readConfiguration: async () => providerConfiguration,
      claimDraft: async () => { claimed = true; },
      createClient: () => { clientCreated = true; },
    }),
    (error) => error instanceof OdooOutboundError && error.code === "ODOO_VEHICLE_UNMAPPED",
  );
  assert.equal(claimed, false);
  assert.equal(clientCreated, false);
});

test("live Odoo UoM drift blocks creation before payload persistence", async () => {
  let payloadUpdated = false;
  const products = [...providerProducts().values()];
  products[0] = { ...products[0], uom_id: [99, "Days"] };
  await assert.rejects(
    () => createOdooWorkorderDraft({ companyId, workorderId, userId }, {
      readExported: async () => null,
      readReadiness: async () => readyData(),
      readConfiguration: async () => providerConfiguration,
      claimDraft: async () => ({ claimed: true, replayed: false }),
      createClient: () => ({
        execute: async (model, method) => {
          if (method === "fields_get") return requiredOrderFields();
          if (method === "search_read") return [];
          if (model === "res.partner") return { invoice: 302, delivery: 303 };
          if (model === "product.product" && method === "read") return products;
          throw new Error(`Unexpected ${model}.${method}`);
        },
      }),
      updatePayload: async () => { payloadUpdated = true; },
      recordFailure: async () => {},
    }),
    (error) => error instanceof OdooOutboundError && error.code === "ODOO_LABOR_PRODUCT_INVALID",
  );
  assert.equal(payloadUpdated, false);
});

test("multiple marked orders fail closed and record a conflict", async () => {
  const failures = [];
  await assert.rejects(
    () => createOdooWorkorderDraft({ companyId, workorderId, userId }, {
      readExported: async () => null,
      readReadiness: async () => readyData(),
      readConfiguration: async () => providerConfiguration,
      claimDraft: async () => ({ claimed: true, replayed: false }),
      createClient: () => ({
        execute: async (_model, method) => {
          if (method === "fields_get") return requiredOrderFields();
          if (method === "search_read") return [
            { id: 1, name: "S1", state: "draft" },
            { id: 2, name: "S2", state: "draft" },
          ];
          throw new Error("No create is allowed after a conflict.");
        },
      }),
      recordFailure: async (input) => failures.push(input),
    }),
    (error) => error instanceof OdooOutboundError && error.code === "ODOO_DRAFT_CONFLICT",
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, "ODOO_DRAFT_CONFLICT");
});

test("an unknown Odoo create result enters manual reconciliation instead of retrying", async () => {
  const failures = [];
  const timeout = new Error("connection timeout");
  timeout.code = "ODOO_CONNECTION_TIMEOUT";
  await assert.rejects(
    () => createOdooWorkorderDraft({ companyId, workorderId, userId }, {
      readExported: async () => null,
      readReadiness: async () => readyData(),
      readConfiguration: async () => providerConfiguration,
      claimDraft: async () => ({ claimed: true, replayed: false }),
      updatePayload: async () => {},
      createClient: () => ({
        execute: async (model, method) => {
          if (method === "fields_get") return requiredOrderFields();
          if (method === "search_read") return [];
          if (model === "res.partner") return { invoice: 302, delivery: 303 };
          if (model === "product.product" && method === "read") return [...providerProducts().values()];
          if (model === "sale.order" && method === "create") throw timeout;
          throw new Error(`Unexpected ${model}.${method}`);
        },
      }),
      recordFailure: async (input) => failures.push(input),
    }),
    (error) => error instanceof OdooOutboundError
      && error.code === "ODOO_CREATE_RESULT_UNKNOWN"
      && error.statusCode === 409,
  );
  assert.equal(failures[0].code, "ODOO_CREATE_RESULT_UNKNOWN");
});

test("outbound implementation contains durable state but no confirm/invoice calls", async () => {
  const [service, repository] = await Promise.all([
    readFile(new URL("./odoo.outbound.service.js", import.meta.url), "utf8"),
    readFile(new URL("./odoo.outbound.repo.js", import.meta.url), "utf8"),
  ]);
  assert.match(repository, /for update/);
  assert.match(repository, /odoo_outbound_order_attempts/);
  assert.match(repository, /ODOO_ATTEMPT_LEASE_EXPIRED/);
  assert.match(repository, /workorderUpdate\.rowCount !== 1/);
  assert.match(repository, /jsonb_typeof\(wo\.form_data->'parts'\) = 'array'/);
  assert.match(repository, /wo\.form_data->>'mileage' as mileage/);
  assert.match(repository, /upsertIntegrationMapping/);
  assert.match(repository, /appendIntegrationAudit/);
  assert.doesNotMatch(service, /action_confirm|_create_invoices|action_post|payment/i);
});
