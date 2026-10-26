import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomerDocumentSource } from "./customer-document-source.service.js";
import { buildCustomerDocumentProjection } from "./customer-document-projection.js";
import { priceCreateAllocations } from "../../db/repositories/workorder-create-pricing.repo.js";
import { readCustomerPortalDocument } from "./customer-documents.service.js";

const id = (digit) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const companyId = id("1"), locationId = id("2"), workorderId = id("3"), partId = id("4"), productId = id("5");
const context = { actor: { id: id("6"), role: "office" }, companyIds: new Set([companyId]),
  companyRoles: new Map([[companyId, "office"]]), locationIds: new Set([locationId]) };
const adjustments = { lineDiscounts: [], documentDiscount: null, overrideReasons: [] };
const profile = { id: id("7"), defaultCurrency: "USD", taxProfileVersionId: id("8"),
  shopIdentity: { legalName: "Fixture shop" }, authorizationText: "Fixture authorization",
  lineTaxPolicy: { labor: "exempt", part: "exclusive" }, taxComponents: [{ name: "Fixture tax", rate: "10", compound: false }],
  discountPolicy: { maxOfficePercentage: "5" } };

function actualsClient({ partSelection = "batch_cost", laborSelection = "selling_price", quantity = "1", priceQuantity = quantity,
  unitPrice = "98.0000", totalPrice = "98.0000", currency = "USD", noStock = false, manualOverride = false } = {}) {
  const rows = [
    [{ id: workorderId, company_id: companyId, location_id: locationId, status: "mechanic_done", progress_version: 1,
      form_data: { unitNo: "G2026", parts: [], laborHours: "1", laborProduct: { productId, uomCode: "hr" } } }],
    [],
    [{ id: id("9"), status: "consumed", catalog_part_id: partId, uom_code: "ea", effective_quantity: quantity,
      part_number: "FUEL-PART", price_snapshot_id: id("a"), selection: partSelection,
      unit_price: unitPrice, total_price: totalPrice, price_quantity: priceQuantity, currency, manual_override: manualOverride }],
    [],
    [{ id: id("b"), labor_product_id: productId, rate_version_id: id("c"), selection: laborSelection,
      hours: "1", uom_code: "hr", unit_price: "100.0000", total_price: "100.0000", currency: "USD", product_name: "Labor" }],
  ];
  if (noStock) {
    rows[0][0].form_data.parts = [{ noStockLineId: id("9"), catalogPartId: partId, qty: "1", uomCode: "ea" }];
    rows[2] = [];
    rows[3] = [{ id: id("a"), no_stock_line_id: id("9"), catalog_part_id: partId, uom_code: "ea", quantity: "1",
      selection: partSelection, unit_price: "98.0000", total_price: "98.0000", currency }];
  }
  return { query: async () => ({ rows: rows.shift() || [] }) };
}

async function workorderProjection(options = {}, documentType = "estimate", selectedAdjustments = adjustments) {
  const source = await buildCustomerDocumentSource(context,
    { kind: "workorder", id: workorderId, expectedVersion: 1 }, selectedAdjustments, profile,
    { client: actualsClient(options), companyId, locationId, documentType });
  return buildCustomerDocumentProjection(source).projection;
}

test("G2026 Estimate and Invoice bill selected batch part cost plus selling labor with exact source evidence", async () => {
  for (const documentType of ["estimate", "invoice"]) {
    const projection = await workorderProjection({}, documentType);
    assert.equal(projection.totals.subtotal, "198.00");
    assert.equal(projection.totals.tax, "9.80");
    assert.equal(projection.totals.total, "207.80");
    assert.deepEqual(projection.lines.map((line) => line.priceBasis), ["selling_price", "batch_cost"]);
    assert.equal(projection.lines[1].source.priceVersionId, id("a"));
    assert.match(projection.financialFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(projection.basis, documentType === "invoice" ? "actual" : "estimated");
  }
});

test("configured internal line prices mix with selling prices without becoming manual overrides", async () => {
  const projection = await workorderProjection({ partSelection: "internal_cost" });
  assert.equal(projection.totals.subtotal, "198.00");
  assert.equal(projection.lines[1].priceBasis, "internal_cost");
  assert.equal(projection.lines[1].source.overrideReason, null);
  assert.equal((await workorderProjection({ partSelection: "selling_price", laborSelection: "internal_cost" })).lines[0].priceBasis, "internal_cost");
});

test("mixed-price support retains stale quantity, unknown selection, invalid labor and currency guards", async () => {
  for (const options of [{ priceQuantity: "2" }, { partSelection: "unknown" }, { laborSelection: "batch_cost" }, { partSelection: null }]) {
    await assert.rejects(workorderProjection(options), (error) => error.code === "CUSTOMER_DOCUMENT_SELLING_PRICE_REQUIRED");
  }
  await assert.rejects(workorderProjection({ currency: "CAD" }), (error) => error.code === "CUSTOMER_DOCUMENT_CURRENCY_MISMATCH");
});

test("no-stock lines accept configured prices but cannot select physical batch cost", async () => {
  await assert.rejects(workorderProjection({ noStock: true }), (error) => error.code === "CUSTOMER_DOCUMENT_SELLING_PRICE_REQUIRED");
  assert.equal((await workorderProjection({ noStock: true, partSelection: "internal_cost" })).totals.subtotal, "198.00");
});

test("choosing a cost source does not bypass manual override reason and Admin policy", async () => {
  await assert.rejects(workorderProjection({ manualOverride: true }), /reason is required/);
  await assert.rejects(workorderProjection({ manualOverride: true }, "estimate", {
    ...adjustments, overrideReasons: [{ lineId: `part-usage:${id("9")}`, reason: "Fixture approval" }],
  }), (error) => error.code === "CUSTOMER_DOCUMENT_PRICE_OVERRIDE_DENIED");
});

test("draft Estimate retains independent selected part and labor sources through financial projection", async () => {
  const saved = { id: workorderId, companyId, locationId, status: "active", version: 1, payload: {
    concern: "Fuel pump change", pricing: { parts: [{ partIndex: 0, selection: "batch_cost" }], labor: { selection: "selling_price" } },
    formData: { customerCompanyName: "Fixture customer", unitNo: "G2026", laborHours: "1", laborProduct: { productId, name: "Labor", uomCode: "hr" },
      parts: [{ catalogPartId: partId, partNo: "FUEL-PART", qty: "1", uomCode: "ea" }] },
  } };
  const source = await buildCustomerDocumentSource(context, { kind: "draft", id: workorderId, expectedVersion: 1 }, adjustments, profile,
    { getDraft: async () => saved, readCreatePricing: async () => ({ fingerprint: "d".repeat(64),
      parts: [{ partIndex: 0, status: "known", price: { selection: "batch_cost", unitPrice: "98", totalPrice: "98", currency: "USD", receiptLineId: id("e") } }],
      labor: { status: "known", price: { selection: "selling_price", unitPrice: "100", totalPrice: "100", currency: "USD", rateVersionId: id("c") } },
    }) });
  const projection = buildCustomerDocumentProjection(source).projection;
  assert.equal(projection.totals.subtotal, "198.00");
  assert.deepEqual(projection.lines.map((line) => line.priceBasis), ["selling_price", "batch_cost"]);
  assert.equal(projection.lines[1].source.priceVersionId, id("e"));
});

test("saved customer documents use exact selected batch total when average unit price is rounded", async () => {
  const projection = await workorderProjection({ quantity: "1000", unitPrice: "0.0101", totalPrice: "10.0500" });
  assert.equal(projection.lines[1].gross, "10.05");
  assert.equal(projection.totals.subtotal, "110.05");
});

async function weightedDraftSource() {
  const price = priceCreateAllocations([
    { costLayerId: id("d"), receiptLineId: id("e"), quantity: "500", unitCost: "0.0100", currency: "USD" },
    { costLayerId: id("9"), receiptLineId: id("f"), quantity: "500", unitCost: "0.0101", currency: "USD" },
  ], "batch_cost", null, "1000");
  assert.equal(price.unitPrice, "0.0101");
  assert.equal(price.totalPrice, "10.0500");
  const saved = { id: workorderId, companyId, locationId, status: "active", version: 1, payload: {
    concern: "Weighted batch fixture", pricing: { parts: [{ partIndex: 0, selection: "batch_cost" }] },
    formData: { parts: [{ catalogPartId: partId, partNo: "BATCH", qty: "1000", uomCode: "ea" }] },
  } };
  return buildCustomerDocumentSource(context, { kind: "draft", id: workorderId, expectedVersion: 1 }, adjustments, profile,
    { getDraft: async () => saved, readCreatePricing: async () => ({ fingerprint: "d".repeat(64),
      parts: [{ partIndex: 0, status: "known", price }], labor: { status: "empty" } }) });
}

test("draft customer documents use exact multi-batch total instead of rounded average times quantity", async () => {
  const projection = buildCustomerDocumentProjection(await weightedDraftSource()).projection;
  assert.equal(projection.totals.subtotal, "10.05");
  assert.equal(projection.lines[0].gross, "10.05");
});

test("draft batch line retains all receipt and cost-layer references", async () => {
  const projection = buildCustomerDocumentProjection(await weightedDraftSource()).projection;
  assert.deepEqual(projection.lines[0].source.receiptLineIds, [id("e"), id("f")]);
  assert.deepEqual(projection.lines[0].source.costLayerIds, [id("d"), id("9")]);
});

test("issued customer portal retains charged source total for average-price display without exposing internal references", async () => {
  const snapshot = buildCustomerDocumentProjection(await weightedDraftSource()).projection;
  const result = await readCustomerPortalDocument("A".repeat(43), { idempotencyKey: "view:mixed-price-fixture" }, {
    readGrant: async () => ({ grant: { allowedActions: ["view_revision"], expiresAt: "2099-01-01T00:00:00.000Z" },
      revision: { snapshot }, responseEligible: false, response: { status: "not_applicable" } }),
  });
  assert.equal(result.document.lines[0].sourceTotal, "10.05");
  assert.equal(result.document.lines[0].total, "11.06");
  assert.equal("source" in result.document.lines[0], false);
});
