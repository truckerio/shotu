import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomerDocumentSource } from "./customer-document-source.service.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const draftId = "33333333-3333-4333-8333-333333333333";
const partId = "44444444-4444-4444-8444-444444444444";
const productId = "55555555-5555-4555-8555-555555555555";

const context = (role = "office") => ({ actor: { id: "actor", role } });
const profile = {
  id: "66666666-6666-4666-8666-666666666666",
  defaultCurrency: "USD",
  taxProfileVersionId: "77777777-7777-4777-8777-777777777777",
  taxComponents: [{ name: "Sales tax", rate: "10", compound: false }],
  lineTaxPolicy: { labor: "exclusive", part: "exclusive", shop_supply: "exclusive", fee: "exclusive", core_charge: "exclusive", credit: "out_of_scope" },
  discountPolicy: { maxOfficePercentage: "5", reasonRequired: true },
  shopIdentity: { legalName: "Trusted Repair" },
  documentTerms: { estimate: "Terms", warranty: "Warranty", footer: "Footer" },
  authorizationText: "Authorize",
};

function draft() {
  return {
    id: draftId, companyId, locationId, status: "active", version: 3,
    payload: {
      companyId, locationId, concern: "Repair brakes", inventoryUnitSelections: [], inventoryPositionSelections: [],
      pricing: { parts: [{ partIndex: 0, selection: "selling_price" }], labor: { selection: "selling_price" } },
      formData: {
        customerCompanyName: "Customer Co", unitNo: "T-42", laborHours: "2",
        laborProduct: { productId, name: "Repair labor", uomCode: "hr" },
        parts: [{ catalogPartId: partId, partNo: "BRAKE", qty: "1", uomCode: "pc", repairOrder: "Brake chamber" }],
      },
    },
  };
}

function pricing(overrides = {}) {
  return {
    fingerprint: "a".repeat(64),
    parts: [{ partIndex: 0, status: "known", price: {
      selection: "selling_price", unitPrice: "80.0000", totalPrice: "80.0000", currency: "USD",
      sellingPolicyVersionId: "88888888-8888-4888-8888-888888888888",
    } }],
    labor: { status: "known", price: {
      selection: "selling_price", unitPrice: "100.0000", totalPrice: "200.0000", currency: "USD",
      rateVersionId: "99999999-9999-4999-8999-999999999999",
    } },
    ...overrides,
  };
}

test("draft adapter derives customer lines and lineage only from the saved source and pricing reader", async () => {
  let pricingInput;
  const output = await buildCustomerDocumentSource(
    context(), { kind: "draft", id: draftId, expectedVersion: 3 },
    { lineDiscounts: [], documentDiscount: null, overrideReasons: [] }, profile,
    { getDraft: async () => draft(), readCreatePricing: async (input) => (pricingInput = input, pricing()) },
  );
  assert.equal(pricingInput.pricing.parts[0].selection, "selling_price");
  assert.deepEqual(output.financial.lines.map((line) => line.id), ["labor", "part:0"]);
  assert.equal(output.financial.lines[1].unitPrice, "80.0000");
  assert.equal(output.financial.lines[1].source.priceVersionId, "88888888-8888-4888-8888-888888888888");
  assert.equal(output.response.status, "pending");
  assert.equal(output.sourceEvidence.pricingFingerprint, "a".repeat(64));
});

test("draft adapter rejects internal pricing and discounts above published Office authority", async () => {
  await assert.rejects(
    buildCustomerDocumentSource(context(), { kind: "draft", id: draftId, expectedVersion: 3 },
      { lineDiscounts: [], documentDiscount: null, overrideReasons: [] }, profile,
      { getDraft: async () => draft(), readCreatePricing: async () => pricing({
        parts: [{ partIndex: 0, status: "known", price: { selection: "batch_cost", unitPrice: "20", currency: "USD" } }],
      }) }),
    (error) => error.code === "CUSTOMER_DOCUMENT_SELLING_PRICE_REQUIRED",
  );
  await assert.rejects(
    buildCustomerDocumentSource(context(), { kind: "draft", id: draftId, expectedVersion: 3 },
      { lineDiscounts: [], documentDiscount: { kind: "percentage", value: "6", reason: "Courtesy" }, overrideReasons: [] }, profile,
      { getDraft: async () => draft(), readCreatePricing: async () => pricing() }),
    (error) => error.code === "CUSTOMER_DOCUMENT_DISCOUNT_POLICY_DENIED",
  );
});

test("draft labor keeps Inventory selling-policy provenance when no local labor rate exists", async () => {
  const current = pricing();
  current.labor.price.rateVersionId = null;
  current.labor.price.sellingPolicyVersionId = "88888888-8888-4888-8888-888888888888";
  const output = await buildCustomerDocumentSource(
    context(), { kind: "draft", id: draftId, expectedVersion: 3 },
    { lineDiscounts: [], documentDiscount: null, overrideReasons: [] }, profile,
    { getDraft: async () => draft(), readCreatePricing: async () => current },
  );
  assert.equal(output.financial.lines[0].source.kind, "inventory_selling_policy");
  assert.equal(output.financial.lines[0].source.priceVersionId, current.labor.price.sellingPolicyVersionId);
  assert.equal(output.financial.lines[0].source.pricingFingerprint, current.fingerprint);
});

test("flat service draft customer line uses service quantity and ea unit", async () => {
  const saved = draft();
  saved.payload.formData.laborProduct.uomCode = "ea";
  const output = await buildCustomerDocumentSource(context(), { kind: "draft", id: draftId, expectedVersion: 3 },
    { lineDiscounts: [], documentDiscount: null, overrideReasons: [] }, profile,
    { getDraft: async () => saved, readCreatePricing: async () => pricing() });
  assert.equal(output.financial.lines[0].unit, "ea");
  assert.equal(output.financial.lines[0].quantity, "2");
  assert.equal(output.financial.lines[0].unitPrice, "100.0000");
});

test("draft adapter requires Admin and a reason for a manual customer price override", async () => {
  const overridden = pricing();
  overridden.parts[0].price.manualOverride = true;
  await assert.rejects(
    buildCustomerDocumentSource(context("admin"), { kind: "draft", id: draftId, expectedVersion: 3 },
      { lineDiscounts: [], documentDiscount: null, overrideReasons: [] }, profile,
      { getDraft: async () => draft(), readCreatePricing: async () => overridden }),
    /reason is required/i,
  );
  const output = await buildCustomerDocumentSource(
    context("admin"), { kind: "draft", id: draftId, expectedVersion: 3 },
    { lineDiscounts: [], documentDiscount: null, overrideReasons: [{ lineId: "part:0", reason: "Approved customer agreement" }] }, profile,
    { getDraft: async () => draft(), readCreatePricing: async () => overridden },
  );
  assert.equal(output.financial.lines[1].priceBasis, "customer_override");
  assert.equal(output.financial.lines[1].source.overrideReason, "Approved customer agreement");
});

test("Workorder sources fail closed without a transaction-bound actuals reader", async () => {
  await assert.rejects(buildCustomerDocumentSource(
    context(), { kind: "workorder", id: draftId, expectedVersion: 3 },
    { lineDiscounts: [], documentDiscount: null, overrideReasons: [] }, profile,
    { getWorkorder: async () => assert.fail("unsafe Workorder read must not run") },
  ), (error) => error.code === "CUSTOMER_DOCUMENT_WORKORDER_SOURCE_UNAVAILABLE");
});
