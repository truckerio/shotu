import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { moduleActionSchema } from "./workorder-module-runtime.registry.js";
import { projectLoadedProtectedWorkorderDetail, runWorkorderModuleAction } from "./workorder-module-runtime.service.js";
import { projectProtectedWorkorderDetail } from "./workorder-module-projection.js";
import {
  reviseWorkorderLaborRate,
  selectWorkorderLaborPrice,
  workorderPricingSummary,
} from "./workorder-labor-pricing.service.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
const workorderId = "44444444-4444-4444-8444-444444444444";
const actorId = "55555555-5555-4555-8555-555555555555";
const office = { actor: { id: actorId, role: "office" }, companyIds: new Set([companyId]), locationIds: new Set([locationId]) };
const authorization = { companyId, locationId, workorder: { status: "in_progress" } };

test("labor rate and Workorder snapshot actions validate their input", () => {
  const rate = moduleActionSchema("diagnosisRepair", "record").parse({
    operation: "laborRateRevision", productId, locationId, priceKind: "selling_price",
    expectedVersion: 0, amount: "25.0000", currency: "USD", reason: "Shop selling rate",
    idempotencyKey: "labor-rate-1",
  });
  assert.equal(rate.amount, "25.0000");
  const selection = moduleActionSchema("diagnosisRepair", "record").parse({
    operation: "laborPriceSelection", selection: "internal_cost", reason: "Use local internal rate",
    idempotencyKey: "labor-price-1",
  });
  assert.equal(selection.selection, "internal_cost");
  assert.equal(moduleActionSchema("diagnosisRepair", "record").safeParse({
    ...rate, amount: "-1",
  }).success, false);
});

test("only Office/Admin can revise rates and select snapshots", async () => {
  const mechanic = { ...office, actor: { ...office.actor, role: "mechanic" } };
  await assert.rejects(() => reviseWorkorderLaborRate(workorderId, {}, mechanic, authorization), { code: "WORKORDER_LABOR_PRICE_FORBIDDEN" });
  await assert.rejects(() => selectWorkorderLaborPrice(workorderId, {}, mechanic), { code: "WORKORDER_LABOR_PRICE_FORBIDDEN" });
});

test("rate revisions use authenticated company and reject other locations or terminal Workorders", async () => {
  const input = { productId, locationId, priceKind: "selling_price", expectedVersion: 0,
    amount: "25.0000", currency: "USD", reason: "Shop selling rate", idempotencyKey: "labor-rate-1" };
  let received;
  const result = await reviseWorkorderLaborRate(workorderId, input, office, authorization, {
    appendLaborRate: async (value) => { received = value; return { kind: "saved", rate: { version: 1 } }; },
  });
  assert.equal(result.rate.version, 1);
  assert.equal(received.companyId, companyId);
  assert.equal(received.actorId, actorId);
  assert.equal(received.locationId, locationId);
  await assert.rejects(() => reviseWorkorderLaborRate(workorderId, { ...input, locationId: null }, office, authorization, {
    appendLaborRate: async () => { throw new Error("Office must not create a company-wide rate."); },
  }), { code: "WORKORDER_LABOR_RATE_LOCATION_FORBIDDEN", statusCode: 403 });
  await assert.rejects(() => reviseWorkorderLaborRate(workorderId, { ...input, locationId: productId }, office, authorization), { code: "WORKORDER_LABOR_RATE_LOCATION_FORBIDDEN" });
  const admin = { ...office, actor: { ...office.actor, role: "admin" } };
  const companyDefault = await reviseWorkorderLaborRate(workorderId, { ...input, locationId: null }, admin, authorization, {
    appendLaborRate: async (value) => ({ kind: "saved", rate: { locationId: value.locationId } }),
  });
  assert.equal(companyDefault.rate.locationId, null);
  await assert.rejects(() => reviseWorkorderLaborRate(workorderId, input, office, { ...authorization, workorder: { status: "closed" } }), { code: "WORKORDER_LABOR_PRICE_LOCKED" });
  await assert.rejects(() => reviseWorkorderLaborRate(workorderId, { ...input, currency: null }, office, authorization), { code: "WORKORDER_LABOR_RATE_INVALID" });
});

test("labor snapshot maps missing or Unknown rates to a closed failure", async () => {
  const input = { selection: "selling_price", reason: "Use configured rate", idempotencyKey: "labor-price-1" };
  await assert.rejects(() => selectWorkorderLaborPrice(workorderId, input, office, {
    saveLaborPrice: async () => ({ kind: "rate_unavailable" }),
  }), { code: "WORKORDER_LABOR_RATE_UNAVAILABLE", statusCode: 422 });
});

test("summary totals exact current snapshots and refuses missing, changed, mixed currency or basis", () => {
  const base = {
    workorder: { formData: { laborHours: "2.5", laborProduct: { productId }, parts: [] } },
    installedSerializedParts: [{ quantity: 1, price: { selection: "selling_price", totalPrice: "10.0000", currency: "USD" } }],
    aggregatePartUsages: [{ effectiveQuantity: 2, status: "consumed", price: { selection: "selling_price", quantity: "2.000", totalPrice: "40.0000", currency: "USD" } }],
    laborPrice: { productId, selection: "selling_price", hours: "2.50", totalPrice: "62.5000", currency: "USD" },
  };
  assert.deepEqual(workorderPricingSummary(base), {
    status: "complete", currency: "USD", partsTotal: "50.0000", laborTotal: "62.5000",
    grandTotal: "112.5000", missingCount: 0, rowCount: 3,
  });
  assert.equal(workorderPricingSummary({ ...base, laborPrice: null }).status, "incomplete");
  assert.equal(workorderPricingSummary({ ...base, aggregatePartUsages: [{ ...base.aggregatePartUsages[0], effectiveQuantity: 3 }] }).missingCount, 1);
  assert.equal(workorderPricingSummary({ ...base, laborPrice: { ...base.laborPrice, currency: "CAD" } }).status, "mixed_currency");
  assert.equal(workorderPricingSummary({ ...base, laborPrice: { ...base.laborPrice, selection: "internal_cost" } }).reason, "mixed_price_basis");
  const legacyManual = workorderPricingSummary({
    ...base,
    workorder: { ...base.workorder, formData: { ...base.workorder.formData, parts: [{ partNo: "P1", qty: "2" }] } },
  });
  assert.equal(legacyManual.status, "incomplete");
  assert.equal(legacyManual.missingCount, 1);
  const truncated = workorderPricingSummary({ ...base, pricingRowsTruncated: true });
  assert.equal(truncated.status, "incomplete");
  assert.equal(truncated.missingCount, 1);
});

test("mechanic projection omits all labor financials and Office sees required shape", () => {
  const detail = { workorder: { id: workorderId, formData: { laborHours: "2", laborProduct: { productId } } },
    laborPrice: { selection: "selling_price", unitPrice: "25.0000", totalPrice: "50.0000", currency: "USD" },
    currentLaborRates: { selling_price: { amount: "25.0000", currency: "USD" } },
    workorderPricing: { status: "complete", grandTotal: "50.0000" } };
  const decisions = { diagnosisRepair: { access: "write" }, parts: { access: "write" } };
  const mechanic = projectProtectedWorkorderDetail(detail, decisions, { viewerRole: "mechanic" });
  assert.equal(JSON.stringify(mechanic).includes("25.0000"), false);
  assert.equal("workorderPricing" in mechanic, false);
  const officeView = projectProtectedWorkorderDetail(detail, decisions, { viewerRole: "office" });
  assert.equal(officeView.modules.diagnosisRepair.data.laborPrice.unitPrice, "25.0000");
  assert.equal(officeView.workorderPricing.grandTotal, "50.0000");
});

test("diagnosis record routes selected labor pricing after Workorder authorization", async () => {
  let selected;
  const output = await runWorkorderModuleAction(
    office, workorderId, "diagnosisRepair", "record",
    { operation: "laborPriceSelection", selection: "selling_price" },
    {
      authorize: async () => authorization,
      selectLaborPrice: async (...args) => { selected = args; return { kind: "saved" }; },
    },
  );
  assert.equal(output.kind, "saved");
  assert.equal(selected[0], workorderId);
  assert.equal(selected[2], office);
});

test("loaded Office detail includes current labor rates and a pricing total", async () => {
  const detail = { workorder: {
    id: workorderId, companyId, locationId,
    formData: { laborHours: "2", laborProduct: { productId }, parts: [] },
  } };
  const result = await projectLoadedProtectedWorkorderDetail(detail, {
    diagnosisRepair: { access: "write" }, parts: { access: "write" },
  }, { viewerRole: "office" }, {
    listInstalledParts: async () => [], listAggregateUsages: async () => [],
    readLaborPricing: async () => ({
      laborPrice: { productId, selection: "selling_price", hours: "2.00", unitPrice: "25.0000", totalPrice: "50.0000", currency: "USD" },
      currentLaborRates: { selling_price: { amount: "25.0000", currency: "USD" } },
    }),
  });
  assert.equal(result.modules.diagnosisRepair.data.currentLaborRates.selling_price.amount, "25.0000");
  assert.equal(result.workorderPricing.grandTotal, "50.0000");
});

test("migration keeps local rates and immutable snapshots separate from Odoo", async () => {
  const sql = await readFile(new URL("../../db/migrations/180_workorder_labor_pricing.sql", import.meta.url), "utf8");
  assert.match(sql, /create table labor_rate_versions/i);
  assert.match(sql, /create table workorder_labor_price_snapshots/i);
  assert.match(sql, /rate_version_id uuid not null/i);
  assert.doesNotMatch(sql, /update\s+odoo_service_products/i);
});
