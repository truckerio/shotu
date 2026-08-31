import assert from "node:assert/strict";
import test from "node:test";
import { updateInventoryPart } from "./inventory-part-details.service.js";

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
