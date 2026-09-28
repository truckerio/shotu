import test from "node:test";
import assert from "node:assert/strict";
import { applyCreatePriceOverride, priceCreateAllocations, createPricingFingerprint, readCreatePricing } from "../../db/repositories/workorder-create-pricing.repo.js";
import { createWorkorderPricingSchema } from "./workorder.schemas.js";
import { previewCreateWorkorderPricing, createWorkorderRuntime } from "./workorder-module-runtime.service.js";
import { handleWorkorderModulesApi } from "../../routes/workorder-modules.routes.js";
import { submitWorkorderDraftSchema } from "./workorder-drafts.schemas.js";

test("create preview uses weighted exact batches and preserves allocation totals", () => {
  const price = priceCreateAllocations([
    { costLayerId: "old", quantity: "1", unitCost: "10", currency: "USD" },
    { costLayerId: "new", quantity: "4", unitCost: "20", currency: "USD" },
  ], "batch_cost", null, "5");
  assert.equal(price.totalPrice, "90.0000");
  assert.equal(price.unitPrice, "18.0000");
  assert.deepEqual(price.allocations.map((row) => row.totalPrice), ["10.0000", "80.0000"]);
});

test("create preview respects fixed selling prices and rejects unknown batch cost or mixed currency", () => {
  const allocation = { quantity: "1", unitCost: null, currency: null };
  assert.equal(priceCreateAllocations([allocation], "selling_price", { id: "fixed", method: "fixed", value: "25", currency: "USD" }, "1").totalPrice, "25.0000");
  assert.throws(() => priceCreateAllocations([allocation], "batch_cost", null, "1"));
  assert.throws(() => priceCreateAllocations([{ quantity: "1", unitCost: "5", currency: "USD" }, { quantity: "1", unitCost: "5", currency: "CAD" }], "batch_cost", null, "2"));
});

test("create preview keeps base evidence when one Workorder overrides the unit price", () => {
  const base = priceCreateAllocations([{ quantity: "4", unitCost: "10", currency: "USD" }], "batch_cost", null, "4");
  const overridden = applyCreatePriceOverride(base, "12.50");
  assert.equal(overridden.baseUnitPrice, "10.0000");
  assert.equal(overridden.unitPrice, "12.5000");
  assert.equal(overridden.totalPrice, "50.0000");
  assert.equal(overridden.manualOverride, true);
  assert.equal(overridden.allocations[0].unitPrice, "10.0000", "source allocation remains the original batch evidence");
  assert.equal(applyCreatePriceOverride(base, "10.0000"), base, "an unchanged amount is not an override");
});

test("fingerprint binds exact batch identity, price, quantity and location but ignores snapshot IDs", () => {
  const input = { companyId: "company", locationId: "shop", formData: { parts: [] } };
  const price = priceCreateAllocations([{ costLayerId: "old", quantity: "1", unitCost: "5", currency: "USD" }], "batch_cost", null, "1");
  const fingerprint = createPricingFingerprint(input, [{ partIndex: 0, price }], null);
  assert.equal(createPricingFingerprint(input, [{ partIndex: 0, price: { ...price, id: "saved-snapshot" } }], null), fingerprint);
  assert.notEqual(createPricingFingerprint({ ...input, locationId: "other" }, [{ partIndex: 0, price }], null), fingerprint);
  assert.notEqual(createPricingFingerprint(input, [{ partIndex: 0, price: { ...price, allocations: [{ ...price.allocations[0], costLayerId: "new" }] } }], null), fingerprint);
});

test("pricing command rejects client amounts and duplicate rows", () => {
  assert.throws(() => createWorkorderPricingSchema.parse({ parts: [{ partIndex: 0, selection: "batch_cost", amount: "1" }] }));
  assert.throws(() => createWorkorderPricingSchema.parse({ parts: [{ partIndex: 0, selection: "batch_cost" }, { partIndex: 0, selection: "selling_price" }] }));
  assert.equal(createWorkorderPricingSchema.parse({ parts: [{ partIndex: 0, selection: "batch_cost", customUnitPrice: "12.3456" }] }).parts[0].customUnitPrice, "12.3456");
  assert.throws(() => createWorkorderPricingSchema.parse({ parts: [{ partIndex: 0, selection: "batch_cost", customUnitPrice: "-1" }] }));
  assert.throws(() => createWorkorderPricingSchema.parse({ parts: [], labor: { selection: "selling_price", customUnitPrice: "1.23456" } }));
});

test("mechanics cannot preview or attach create prices", async () => {
  const context = { actor: { role: "mechanic" } };
  await assert.rejects(previewCreateWorkorderPricing(context, {}), (error) => error.statusCode === 403);
  await assert.rejects(createWorkorderRuntime(context, { pricing: {} }), (error) => error.statusCode === 403);
});

test("create requires a reviewed fingerprint whenever prices are selected", async () => {
  await assert.rejects(createWorkorderRuntime({ actor: { role: "office" } }, { pricing: { parts: [] } }),
    (error) => error.code === "WORKORDER_PRICING_PREVIEW_REQUIRED");
});

test("preview rejects foreign company and Office location before reading prices", async () => {
  const context = { actor: { role: "office" }, companyIds: new Set(["company"]), locationIds: new Set(["shop"]) };
  let reads = 0;
  const dependencies = { readPricing: async () => { reads += 1; } };
  await assert.rejects(previewCreateWorkorderPricing(context, { companyId: "other", locationId: "shop" }, dependencies));
  await assert.rejects(previewCreateWorkorderPricing(context, { companyId: "company", locationId: "other" }, dependencies));
  assert.equal(reads, 0);
});

test("preview route parses selections and never needs a saved Workorder", async () => {
  let body = { concern: "", pricing: { parts: [] }, formData: { parts: [] } };
  let response;
  const helpers = { requestContext: { actor: { role: "office" } }, readBody: async () => body,
    sendJson: (_res, code, value) => { response = { code, value }; } };
  const dependencies = { previewCreatePricing: async (_context, input) => ({ fingerprint: "a".repeat(64), selections: input.pricing.parts }) };
  assert.equal(await handleWorkorderModulesApi({ method: "POST" }, {}, new URL("http://local/api/workorders/create-pricing-preview"), helpers, dependencies), true);
  assert.equal(response.code, 200);
  assert.equal(response.value.fingerprint.length, 64);
  body = { ...body, pricing: { parts: [], amount: "0" } };
  await assert.rejects(handleWorkorderModulesApi({ method: "POST" }, {}, new URL("http://local/api/workorders/create-pricing-preview"), helpers, dependencies), (error) => error.statusCode === 400);
});

test("draft submission accepts a fresh pricing fingerprint and rejects arbitrary amounts", () => {
  const pricing = { parts: [], expectedFingerprint: "a".repeat(64) };
  assert.deepEqual(submitWorkorderDraftSchema.parse({ version: 1, pricing }).pricing, pricing);
  assert.throws(() => submitWorkorderDraftSchema.parse({ version: 1, pricing: { ...pricing, amount: "1" } }));
});

test("serialized preview requires local provider, reservable custody and a pickable physical position", async () => {
  let checkedUnits = false;
  const client = { async query(sql) {
    assert.doesNotMatch(sql, /\b(insert|update|delete|for update)\b/i, "preview remains read only");
    if (sql.includes("from inventory_serialized_units")) {
      assert.match(sql, /join inventory_receipts receipt/);
      assert.match(sql, /receipt.provider in \('local','local_count','local_serialization'\)/);
      assert.match(sql, /unit.custody_holder_type='inventory_location'/);
      assert.match(sql, /unit.condition_code in \('new','serviceable_used','refurbished'\)/);
      assert.match(sql, /position.is_active and position.can_store and position.is_pickable/);
      checkedUnits = true;
    }
    return { rows: [] };
  } };
  const result = await readCreatePricing({ companyId: "company", locationId: "shop",
    formData: { parts: [{ catalogPartId: "part", qty: "1", uomCode: "ea" }] },
    inventoryUnitSelections: [{ partIndex: 0, unitIds: ["unavailable-unit"] }], inventoryPositionSelections: [],
    pricing: { parts: [{ partIndex: 0, selection: "batch_cost" }] },
  }, client);
  assert.equal(checkedUnits, true);
  assert.equal(result.parts[0].status, "incomplete");
  assert.equal(result.parts[0].price, null);
});
