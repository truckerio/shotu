import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { permissionsForRole } from "../../auth/permissions.js";
import { previewInventoryPartPrice, readInventoryPartCommercial, setInventoryPartPrice, updateInventoryLocationPartPrice } from "./inventory-part-prices.service.js";

const partId = "33333333-3333-4333-8333-333333333333";
const companyId = "22222222-2222-4222-8222-222222222222";
const locationId = "44444444-4444-4444-8444-444444444444";
const context = { actor: { id: "11111111-1111-4111-8111-111111111111", role: "office" }, permissions: permissionsForRole("office"), companyIds: new Set([companyId]), locationIds: new Set([locationId]) };

test("commercial read sends tenant and effective location scope and exposes capabilities", async () => {
  let received;
  const result = await readInventoryPartCommercial(partId, new URLSearchParams("limit=25"), context, { read: async (input) => { received = input; return { purchaseCost: {}, prices: {} }; } });
  assert.deepEqual(received, { catalogPartId: partId, companyIds: [companyId], locationIds: [locationId], isAdmin: false, locationId: null, historyLimit: 25 });
  assert.deepEqual(result.capabilities, { canReadCost: true, canEditPrices: true, canManageTaxProfiles: true });
});

test("location commercial read resolves one authorized company and location", async () => {
  let received;
  const result = await readInventoryPartCommercial(partId, new URLSearchParams(`locationId=${locationId}&limit=10`), context, {
    resolveLocationScope: async (receivedContext, receivedLocationId) => {
      assert.strictEqual(receivedContext, context);
      assert.equal(receivedLocationId, locationId);
      return { companyIds: [companyId], locationIds: [locationId], isAdmin: false };
    },
    read: async (input) => { received = input; return { purchaseCost: {}, receiptCosts: {}, prices: {} }; },
  });
  assert.equal(result.capabilities.canReadCost, true);
  assert.deepEqual(received, { catalogPartId: partId, companyIds: [companyId], locationIds: [locationId], isAdmin: false, locationId, historyLimit: 10 });
});

test("commercial read and price writes require separate financial permissions", async () => {
  await assert.rejects(() => readInventoryPartCommercial(partId, new URLSearchParams(), { ...context, permissions: new Set() }, { read: async () => ({}) }), (error) => error.statusCode === 403);
  await assert.rejects(() => setInventoryPartPrice(partId, "internal", { expectedVersion: 0, amount: "10.0000", currency: "USD", reason: "Initial price", idempotencyKey: "request-123" }, { ...context, permissions: new Set() }, { append: async () => ({}) }), (error) => error.statusCode === 403);
});

test("price write preserves zero, supports Unknown, hashes the canonical command and maps conflicts", async () => {
  let received;
  const result = await setInventoryPartPrice(partId, "selling", { expectedVersion: 0, amount: "0", currency: "cad", reason: "No charge", idempotencyKey: "request-123" }, context, { append: async (input) => { received = input; return { kind: "saved", price: { version: 1 }, replayed: false }; } });
  assert.equal(result.price.version, 1);
  assert.equal(received.amount, "0");
  assert.equal(received.currency, "CAD");
  assert.equal(received.requestHash, createHash("sha256").update(JSON.stringify({
    catalogPartId: partId, kind: "selling", expectedVersion: 0, amount: "0", currency: "CAD", reason: "No charge",
  })).digest("hex"));
  await assert.rejects(() => setInventoryPartPrice(partId, "selling", { expectedVersion: 1, amount: null, currency: null, reason: "Clear price", idempotencyKey: "request-456" }, context, { append: async () => ({ kind: "stale" }) }), (error) => error.code === "INVENTORY_PART_PRICE_STALE");
  await assert.rejects(() => setInventoryPartPrice(partId, "selling", { expectedVersion: 1, amount: null, currency: null, reason: "Clear price", idempotencyKey: "request-789" }, context, { append: async () => ({ kind: "idempotency_conflict" }) }), (error) => error.code === "INVENTORY_PART_PRICE_REPLAY_CONFLICT");
});

test("location override write scopes authorization and request hash to the location", async () => {
  let received;
  const result = await updateInventoryLocationPartPrice(partId, locationId, "internal", {
    expectedVersion: 0, amount: null, currency: null, reason: "Unknown at this shop", idempotencyKey: "location-price-123",
  }, context, {
    resolveLocationScope: async (_context, receivedLocationId) => {
      assert.equal(receivedLocationId, locationId);
      return { companyIds: [companyId], locationIds: [locationId], isAdmin: false };
    },
    append: async (input) => { received = input; return { kind: "saved", price: { locationId, status: "unknown", version: 1 }, replayed: false }; },
  });
  assert.equal(result.price.status, "unknown");
  assert.equal(received.locationId, locationId);
  assert.deepEqual(received.companyIds, [companyId]);
  assert.deepEqual(received.locationIds, [locationId]);
  const expectedHashInput = {
    catalogPartId: partId, locationId, kind: "internal", expectedVersion: 0, amount: null, currency: null,
    reason: "Unknown at this shop",
  };
  assert.equal(received.requestHash, createHash("sha256").update(JSON.stringify(expectedHashInput)).digest("hex"));
});

test("location override denies an unresolved location before persistence", async () => {
  await assert.rejects(() => updateInventoryLocationPartPrice(partId, locationId, "selling", {
    expectedVersion: 0, amount: "2", currency: "USD", reason: "Scoped price", idempotencyKey: "location-price-456",
  }, context, {
    resolveLocationScope: async () => { throw Object.assign(new Error("Not found"), { statusCode: 404 }); },
    append: () => assert.fail("Unauthorized location reached persistence"),
  }), (error) => error.statusCode === 404);
});

test("price input rejects unpaired currency, binary floats and unknown kinds", async () => {
  const append = async () => ({ kind: "saved" });
  await assert.rejects(() => setInventoryPartPrice(partId, "cost", { expectedVersion: 0, amount: "1", currency: "USD", reason: "Bad kind", idempotencyKey: "request-123" }, context, { append }));
  await assert.rejects(() => setInventoryPartPrice(partId, "internal", { expectedVersion: 0, amount: null, currency: "USD", reason: "Bad pair", idempotencyKey: "request-123" }, context, { append }));
  await assert.rejects(() => setInventoryPartPrice(partId, "internal", { expectedVersion: 0, amount: 0.1, currency: "USD", reason: "Number input", idempotencyKey: "request-123" }, context, { append }));
});

test("preview preserves legacy unsupported currency as an explicit blocker instead of throwing", async () => {
  const result = await previewInventoryPartPrice(partId, { priceKind: "selling", quantity: "1", discountPercent: "0" }, context, {
    readPricingSource: async () => ({
      part: { catalogPartId: partId, companyId, uomCode: "ea", displayUomCode: "ea", trackingMode: "quantity" },
      price: { id: partId, version: 1, amount: "10.0000", currency: "ZZZ", taxTreatment: "legacy_unknown", taxProfileVersionId: null },
    }),
  });
  assert.equal(result.unitPrice, "10.0000");
  assert.equal(result.subtotal, null);
  assert.deepEqual(result.blockers, ["currency_unsupported"]);
});

test("preview enforces tracking-aware quantity precision and rejects discounts above 100", async () => {
  const dependencies = { readPricingSource: async () => ({
    part: { catalogPartId: partId, companyId, uomCode: "ea", displayUomCode: "ea", trackingMode: "serialized" },
    price: { id: partId, version: 1, amount: "10", currency: "USD", taxTreatment: "zero_rated", taxProfileVersionId: null },
  }) };
  await assert.rejects(() => previewInventoryPartPrice(partId, { priceKind: "selling", quantity: "0.5", discountPercent: "0" }, context, dependencies), (error) => error.code === "INVENTORY_PRICE_QUANTITY_PRECISION");
  await assert.rejects(() => previewInventoryPartPrice(partId, { priceKind: "selling", quantity: "1", discountPercent: "100.0001" }, context, dependencies));
});

test("saved preview uses its immutable archived profile while draft requires current active profile", async () => {
  const profile = { id: locationId, profileId: companyId, version: 1, name: "Old tax", currency: "USD", jurisdiction: "Test", state: "active", components: [{ name: "Tax", rate: "10", compound: false }] };
  const readPricingSource = async () => ({
    part: { catalogPartId: partId, companyId, uomCode: "l", displayUomCode: "l", trackingMode: "measured_bulk" },
    price: { id: partId, version: 2, amount: "11", currency: "USD", taxTreatment: "inclusive", taxProfileVersionId: profile.id, taxProfile: { ...profile, state: "archived" } },
  });
  const saved = await previewInventoryPartPrice(partId, { priceKind: "selling", quantity: "1.25", discountPercent: "0" }, context, { readPricingSource });
  assert.equal(saved.total, "13.75");
  assert.equal(saved.priceVersion, 2);
  await assert.rejects(() => previewInventoryPartPrice(partId, { priceKind: "selling", quantity: "1.25", discountPercent: "0", draft: { amount: "11", currency: "USD", taxTreatment: "inclusive", taxProfileVersionId: profile.id } }, context, { readPricingSource, readTaxProfileVersion: async () => null }), (error) => error.code === "INVENTORY_PART_PRICE_TAX_PROFILE_INVALID");
});
