import test from "node:test";
import assert from "node:assert/strict";
import { handleInventoryApi } from "./inventory.routes.js";
import { permissionsForRole } from "../../auth/permissions.js";
const companyId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const locationId = "44444444-4444-4444-8444-444444444444";
const context = (role = "office") => ({ actor: { id: actorId, role }, companyIds: new Set([companyId]), locationIds: new Set([locationId]), permissions: permissionsForRole(role) });
const base = "/api/office/inventory/tax-profiles";
const body = { companyId, name: "QA tax", currency: "USD", jurisdiction: "QA only", components: [{ name: "QA component", rate: "5", compound: false }], reason: "Configure QA profile", idempotencyKey: "pricing-route-create-001" };
async function request(method, path, payload, dependencies, ctx = context()) {
  const res = {};
  assert.equal(await handleInventoryApi({ method }, res, new URL(path, "http://localhost"), {
    requestContext: ctx, readBody: async () => payload,
    sendJson: (response, status, value) => Object.assign(response, { status, payload: value }),
  }, dependencies), true);
  return res;
}
test("tax profile routes require explicit company and preserve false archive filter", async () => {
  const res = await request("GET", `${base}?companyId=${companyId}&includeArchived=false`, null, { listTaxProfiles: async (input) => {
    assert.equal(input.companyId, companyId); assert.equal(input.includeArchived, false); return [];
  } });
  assert.equal(res.status, 200); assert.deepEqual(res.payload, { profiles: [] });
  const invalid = await request("GET", base, null, { listTaxProfiles: () => assert.fail("Missing company reached DB") });
  assert.equal(invalid.status, 400);
});
test("tax profile creation includes actor and rejects invalid rates before persistence", async () => {
  const res = await request("POST", base, body, { createTaxProfile: async (input) => {
    assert.equal(input.actorId, actorId); assert.equal(input.companyId, companyId); assert.match(input.requestHash, /^[a-f0-9]{64}$/);
    return { profile: { id: profileId }, replayed: false };
  } });
  assert.equal(res.status, 201); assert.equal(res.payload.profile.id, profileId);
  const invalid = await request("POST", base, { ...body, components: [{ name: "Bad", rate: "101", compound: false }] }, { createTaxProfile: () => assert.fail("Invalid tax reached DB") });
  assert.equal(invalid.status, 400);
});
test("tax profile revision and archive expose conflicts and scoped missing records", async () => {
  const dependencies = { findTaxProfileCompany: async (_id, companies) => { assert.deepEqual(companies, [companyId]); return companyId; }, reviseTaxProfile: async () => ({ kind: "stale" }) };
  const { companyId: _companyId, ...revision } = body;
  const stale = await request("PUT", `${base}/${profileId}`, { ...revision, expectedVersion: 1 }, dependencies);
  assert.equal(stale.status, 409); assert.equal(stale.payload.code, "INVENTORY_TAX_PROFILE_STALE");
  const missing = await request("PATCH", `${base}/${profileId}/archive`, { expectedVersion: 1, archived: true, reason: "Retired", idempotencyKey: "pricing-route-archive-001" }, {
    findTaxProfileCompany: async () => null, archiveTaxProfile: () => assert.fail("Missing profile mutated"),
  });
  assert.equal(missing.status, 404);
});
test("financial profile endpoints deny mechanics before repository access", async () => {
  for (const [method, path, payload] of [["GET", `${base}?companyId=${companyId}`, null], ["POST", base, body]]) {
    await assert.rejects(request(method, path, payload, { listTaxProfiles: () => assert.fail("Unauthorized read"), createTaxProfile: () => assert.fail("Unauthorized write") }, context("mechanic")), e => e.statusCode === 403);
  }
});

test("pricing preview route calculates real tax and rejects invalid quantities or scoped missing parts", async () => {
  const path = `/api/office/inventory/parts/${profileId}/pricing-preview`;
  const dependencies = { readPricingSource: async input => { assert.deepEqual(input.companyIds, [companyId]); return { part: { companyId, uomCode: "ea", trackingMode: "quantity" }, price: { id: profileId, version: 1, amount: "100", currency: "USD", taxTreatment: "exclusive", taxProfileVersionId: actorId, taxProfile: { currency: "USD", components: [{ name: "QA tax", rate: "8", compound: false }] } } }; } };
  const preview = await request("POST", path, { priceKind: "selling", quantity: "2", discountPercent: "10" }, dependencies);
  assert.equal(preview.status, 200); assert.equal(preview.payload.net, "180.00"); assert.equal(preview.payload.tax, "14.40"); assert.equal(preview.payload.total, "194.40");
  const invalid = await request("POST", path, { priceKind: "selling", quantity: "0.5" }, dependencies);
  assert.equal(invalid.status, 400);
  const excessiveDiscount = await request("POST", path, { priceKind: "selling", quantity: "1", discountPercent: "100.0001" }, { readPricingSource: () => assert.fail("Invalid discount reached persistence") });
  assert.equal(excessiveDiscount.status, 400);
  const missing = await request("POST", path, { priceKind: "selling", quantity: "1" }, { readPricingSource: async () => null });
  assert.equal(missing.status, 404);
  await assert.rejects(request("POST", path, { priceKind: "selling", quantity: "1" }, { readPricingSource: () => assert.fail("Unauthorized preview") }, context("mechanic")), e => e.statusCode === 403);
});

test("location pricing routes resolve authorized scope for preview and override writes", async () => {
  const partId = profileId;
  const scope = { companyIds: [companyId], locationIds: [locationId], isAdmin: false };
  const resolveLocationScope = async (_context, receivedLocationId) => {
    assert.equal(receivedLocationId, locationId);
    return scope;
  };
  const previewPath = `/api/office/inventory/parts/${partId}/locations/${locationId}/pricing-preview`;
  const preview = await request("POST", previewPath, { priceKind: "selling", quantity: "1" }, {
    resolveLocationScope,
    readPricingSource: async (input) => {
      assert.equal(input.locationId, locationId);
      assert.deepEqual(input.companyIds, [companyId]);
      return { part: { companyId, uomCode: "ea", trackingMode: "quantity" }, price: { id: partId, version: 1, amount: "0", currency: "USD", taxTreatment: "zero_rated", taxProfileVersionId: null } };
    },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.payload.unitPrice, "0");

  const writePath = `/api/office/inventory/parts/${partId}/locations/${locationId}/prices/internal`;
  const write = await request("PUT", writePath, { expectedVersion: 0, amount: null, currency: null, reason: "Unknown here", idempotencyKey: "location-route-price-1" }, {
    resolveLocationScope,
    append: async (input) => {
      assert.equal(input.locationId, locationId);
      assert.match(input.requestHash, /^[a-f0-9]{64}$/);
      return { kind: "saved", price: { locationId, status: "unknown", version: 1 }, replayed: false };
    },
  });
  assert.equal(write.status, 200);
  assert.equal(write.payload.price.status, "unknown");
});

test("location pricing routes reject unauthorized scope before repository access", async () => {
  const path = `/api/office/inventory/parts/${profileId}/locations/${locationId}/prices/selling`;
  await assert.rejects(request("PUT", path, { expectedVersion: 0, amount: "1", currency: "USD", reason: "Denied", idempotencyKey: "location-route-price-2" }, {
    resolveLocationScope: async () => { throw Object.assign(new Error("Not found"), { statusCode: 404 }); },
    append: () => assert.fail("Unauthorized location reached repository"),
  }), (error) => error.statusCode === 404);
});

test("tax profile endpoints reject a different company before reading or mutating", async () => {
  const otherCompany = "99999999-9999-4999-8999-999999999999";
  const dependencies = { listTaxProfiles: () => assert.fail("Cross-company read"), createTaxProfile: () => assert.fail("Cross-company mutation") };
  for (const [method, path, payload] of [["GET", `${base}?companyId=${otherCompany}`, null], ["POST", base, { ...body, companyId: otherCompany }]]) {
    await assert.rejects(request(method, path, payload, dependencies), e => e.statusCode === 403);
  }
});
