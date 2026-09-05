import assert from "node:assert/strict";
import test from "node:test";
import { createInventoryPart, updateInventoryPart } from "./inventory-part-details.service.js";

const context = { actor: { id: "11111111-1111-4111-8111-111111111111", role: "office" }, companyIds: new Set(["22222222-2222-4222-8222-222222222222"]) };
const input = { expectedVersion: 2, description: "Air valve", partNumber: "A-1", manufacturer: "Bendix", category: "Air", barcode: "123", uomCode: "ea", referenceNumbers: [" BW-1 "] };

test("part edit forwards only authenticated company and normalized strict input", async () => {
  let received;
  const part = await updateInventoryPart("33333333-3333-4333-8333-333333333333", input, context, { updatePart: async (value) => { received = value; return { kind: "updated", part: { version: 3 } }; } });
  assert.equal(part.version, 3);
  assert.deepEqual(received.companyIds, ["22222222-2222-4222-8222-222222222222"]);
  assert.equal(received.uomCode, "ea");
  assert.deepEqual(received.referenceNumbers, ["BW-1"]);
});

test("part edit maps stale, identity, provider, unit and hidden tenant failures", async () => {
  for (const [kind, code, status] of [["stale", "INVENTORY_PART_STALE", 409], ["identity_conflict", "INVENTORY_PART_IDENTITY_CONFLICT", 409], ["provider_managed", "INVENTORY_PART_FIELD_PROVIDER_MANAGED", 422], ["uom_locked", "INVENTORY_PART_UOM_LOCKED", 422], ["uom_incompatible", "INVENTORY_PART_UOM_INCOMPATIBLE", 422], ["not_found", "inventory_not_found", 404]]) {
    await assert.rejects(() => updateInventoryPart("33333333-3333-4333-8333-333333333333", input, context, { updatePart: async () => ({ kind }) }), (error) => error.code === code && error.statusCode === status);
  }
});

test("part edit rejects incomplete and excessive references", async () => {
  await assert.rejects(() => updateInventoryPart("33333333-3333-4333-8333-333333333333", { ...input, description: "" }, context));
  await assert.rejects(() => updateInventoryPart("33333333-3333-4333-8333-333333333333", { ...input, referenceNumbers: Array(21).fill("x") }, context));
});

test("part edit rejects unknown unit codes before repository access", async () => {
  let called = false;
  await assert.rejects(() => updateInventoryPart("33333333-3333-4333-8333-333333333333", { ...input, uomCode: "unknown" }, context, { updatePart: async () => { called = true; } }));
  assert.equal(called, false);
});

test("part edit rejects callers outside Office and Admin before repository access", async () => {
  let called = false;
  await assert.rejects(
    () => updateInventoryPart("33333333-3333-4333-8333-333333333333", input, { ...context, actor: { ...context.actor, role: "mechanic" } }, { updatePart: async () => { called = true; } }),
    (error) => error.code === "INVENTORY_PART_FORBIDDEN" && error.statusCode === 403,
  );
  assert.equal(called, false);
});

test("part create derives company from an authorized location and creates catalog only", async () => {
  let locationScope;
  let createInput;
  const part = await createInventoryPart({
    locationId: "44444444-4444-4444-8444-444444444444", description: "Air valve", partNumber: "A-1", uomCode: "ea", referenceNumbers: ["ODOO-A1"],
  }, { ...context, locationIds: new Set(["44444444-4444-4444-8444-444444444444"]) }, {
    findLocation: async (value) => { locationScope = value; return { company_id: "22222222-2222-4222-8222-222222222222" }; },
    createPart: async (value) => { createInput = value; return { kind: "created", part: { id: "part-1" } }; },
  });
  assert.equal(part.id, "part-1");
  assert.deepEqual(locationScope.companyIds, ["22222222-2222-4222-8222-222222222222"]);
  assert.deepEqual(locationScope.locationIds, ["44444444-4444-4444-8444-444444444444"]);
  assert.equal(createInput.companyId, "22222222-2222-4222-8222-222222222222");
  assert.deepEqual(createInput.referenceNumbers, ["ODOO-A1"]);
});

test("part create hides unauthorized locations and maps identity conflicts", async () => {
  const createInput = { locationId: "44444444-4444-4444-8444-444444444444", description: "Air valve", partNumber: "A-1", uomCode: "ea" };
  await assert.rejects(() => createInventoryPart(createInput, context, { findLocation: async () => null }), (error) => error.code === "inventory_not_found" && error.statusCode === 404);
  await assert.rejects(
    () => createInventoryPart(createInput, context, { findLocation: async () => ({ company_id: "22222222-2222-4222-8222-222222222222" }), createPart: async () => ({ kind: "identity_conflict" }) }),
    (error) => error.code === "INVENTORY_PART_IDENTITY_CONFLICT" && error.statusCode === 409,
  );
});
