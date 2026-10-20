import assert from "node:assert/strict";
import test from "node:test";
import { previewWorkorderPartPricing, selectWorkorderPartPrice } from "./workorder-part-pricing.service.js";

const workorderId = "11111111-1111-4111-8111-111111111111";
const usageId = "22222222-2222-4222-8222-222222222222";
const expectedFingerprint = "a".repeat(64);
const input = {
  operation: "partPriceSelection",
  usageKind: "serialized",
  usageId,
  selection: "batch_cost",
  reason: "Use exact batch cost",
  idempotencyKey: "part-price-test-1",
  expectedFingerprint,
};
const workorderAccess = {
  requireAccess: async () => ({ companyId: workorderId, locationId: usageId }),
  readPriceReplay: async () => null,
};

test("mechanic cannot select or read a workorder financial price", async () => {
  await assert.rejects(
    () => selectWorkorderPartPrice(
      workorderId,
      input,
      { actor: { id: usageId, role: "mechanic" }, companyIds: new Set([workorderId]), companyRoles: new Map([[workorderId, "mechanic"]]), locationIds: new Set([usageId]) },
      { ...workorderAccess, savePartPrice: async () => { throw new Error("must not run"); } },
    ),
    (error) => error.code === "WORKORDER_PART_PRICE_FORBIDDEN" && error.statusCode === 403,
  );

  await assert.rejects(
    () => previewWorkorderPartPricing(
      workorderId,
      { usageKind: "serialized", usageId },
      { actor: { id: usageId, role: "mechanic" }, companyIds: new Set([workorderId]), companyRoles: new Map([[workorderId, "mechanic"]]), locationIds: new Set([usageId]) },
      { ...workorderAccess, readPricingSource: async () => { throw new Error("must not read prices"); } },
    ),
    (error) => error.code === "WORKORDER_PART_PRICE_FORBIDDEN" && error.statusCode === 403,
  );
});

test("office selection uses authenticated scope and maps missing exact batch cost", async () => {
  let received;
  const context = {
    actor: { id: usageId, role: "office" },
    companyIds: new Set([workorderId]),
    companyRoles: new Map([[workorderId, "office"]]),
    locationIds: new Set([usageId]),
  };
  await assert.rejects(
    () => selectWorkorderPartPrice(workorderId, input, context, {
      ...workorderAccess,
      previewPricing: async () => ({ fingerprint: expectedFingerprint, options: { batch_cost: { status: "known" } } }),
      savePartPrice: async (value) => {
        received = value;
        return { kind: "batch_cost_unavailable" };
      },
    }),
    (error) => error.code === "WORKORDER_BATCH_COST_UNAVAILABLE" && error.statusCode === 422,
  );
  assert.deepEqual(received.companyIds, [workorderId]);
  assert.deepEqual(received.locationIds, [usageId]);
  assert.equal(received.actorId, usageId);
});

test("office prices no-stock by server-owned line id and rejects batch cost", async () => {
  const noStockLineId = "33333333-3333-4333-8333-333333333333";
  const noStockInput = {
    operation: "partPriceSelection",
    usageKind: "no_stock",
    noStockLineId,
    selection: "selling_price",
    reason: "Use configured selling policy",
    idempotencyKey: "part-price-no-stock-1",
    expectedFingerprint,
  };
  let received;
  const result = await selectWorkorderPartPrice(workorderId, noStockInput, {
    actor: { id: usageId, role: "office" },
    companyIds: new Set([workorderId]),
    companyRoles: new Map([[workorderId, "office"]]),
    locationIds: new Set([usageId]),
  }, {
    ...workorderAccess,
    previewPricing: async () => ({ fingerprint: expectedFingerprint, options: { selling_price: { status: "known" } } }),
    savePartPrice: async (value) => {
      received = value;
      return { kind: "saved", snapshot: { noStockLineId } };
    },
  });
  assert.equal(received.noStockLineId, noStockLineId);
  assert.equal(Object.hasOwn(received, "usageId"), false);
  assert.equal(result.snapshot.noStockLineId, noStockLineId);

  const configured = await selectWorkorderPartPrice(workorderId, { ...noStockInput, selection: "internal_cost" }, {
    actor: { id: usageId, role: "office" }, companyIds: new Set([workorderId]),
    companyRoles: new Map([[workorderId, "office"]]), locationIds: new Set([usageId]),
  }, { ...workorderAccess,
    previewPricing: async () => ({ fingerprint: expectedFingerprint, options: { internal_cost: { status: "known" } } }),
    savePartPrice: async (value) => ({ kind: "saved", snapshot: { selection: value.selection } }) });
  assert.equal(configured.snapshot.selection, "internal_cost");

  await assert.rejects(
    () => selectWorkorderPartPrice(workorderId, { ...noStockInput, selection: "batch_cost" }, {
      actor: { id: usageId, role: "office" }, companyIds: new Set([workorderId]), companyRoles: new Map([[workorderId, "office"]]), locationIds: new Set([usageId]),
    }, workorderAccess),
    (error) => error.code === "WORKORDER_BATCH_COST_UNAVAILABLE" && error.statusCode === 422,
  );
});

test("primary admin cannot price a workorder in a mechanic-only company", async () => {
  const adminCompany = "44444444-4444-4444-8444-444444444444";
  const context = {
    actor: { id: usageId, role: "admin" },
    companyIds: new Set([adminCompany, workorderId]),
    companyRoles: new Map([[adminCompany, "admin"], [workorderId, "mechanic"]]),
    locationIds: new Set([usageId]),
  };
  await assert.rejects(() => selectWorkorderPartPrice(workorderId, input, context, {
    ...workorderAccess,
    savePartPrice: async () => { throw new Error("must not price"); },
  }), { code: "WORKORDER_PART_PRICE_FORBIDDEN", statusCode: 403 });
});

test("serialized preview returns independently fingerprinted authoritative options for exact candidates", async () => {
  const context = {
    actor: { id: usageId, role: "office" }, companyIds: new Set([workorderId]),
    companyRoles: new Map([[workorderId, "office"]]), locationIds: new Set([usageId]),
  };
  const result = await previewWorkorderPartPricing(workorderId, {
    usageKind: "serialized", catalogPartId: usageId, uomCode: "ea",
    serializedUnitIds: [usageId, "33333333-3333-4333-8333-333333333333"],
  }, context, {
    ...workorderAccess,
    readCreatePricing: async (value) => ({ parts: [{ options: {
      batch_cost: { status: "known", price: { unitPrice: value.inventoryUnitSelections[0].unitIds[0] === usageId ? "8.0000" : "9.0000", totalPrice: "8.0000", currency: "USD" } },
      internal_cost: { status: "known", price: { unitPrice: "10.0000", totalPrice: "10.0000", currency: "USD", configuredPriceVersionId: usageId } },
      selling_price: { status: "known", price: { unitPrice: "12.0000", totalPrice: "12.0000", currency: "USD" } },
    } }] }),
  });
  assert.equal(result.serializedUnits.length, 2);
  assert.match(result.serializedUnits[0].fingerprint, /^[0-9a-f]{64}$/);
  assert.notEqual(result.serializedUnits[0].fingerprint, result.serializedUnits[1].fingerprint);
  assert.equal(result.serializedUnits[0].options.internal_cost.price.configuredPriceVersionId, usageId);
});

test("saved aggregate preview preserves canonical identity and exact allocation lineage", async () => {
  const context = {
    actor: { id: usageId, role: "office" }, companyIds: new Set([workorderId]),
    companyRoles: new Map([[workorderId, "office"]]), locationIds: new Set([usageId]),
  };
  const result = await previewWorkorderPartPricing(workorderId, {
    usageKind: "aggregate", usageId,
  }, context, {
    ...workorderAccess,
    readPricingSource: async () => ({ company_id: workorderId, location_id: usageId,
      catalog_part_id: usageId, part_number: "FILTER-1", uom_code: "ea", quantity: "2.000",
      allocations: [{ costLayerId: usageId, receiptLineId: usageId, quantity: "2.000", unitCost: "7.0000", currency: "USD" }] }),
    readConfiguredSources: async () => ({ configured_price_version_id: usageId,
      configured_amount: "8.5000", configured_currency: "USD" }),
  });
  assert.equal(result.catalogPartId, usageId);
  assert.equal(result.partNumber, "FILTER-1");
  assert.equal(result.options.batch_cost.price.allocations[0].costLayerId, usageId);
  assert.equal(result.options.internal_cost.price.totalPrice, "17.0000");
});

test("saved serialized preview prices its immutable receipt after the unit leaves in-stock custody", async () => {
  const context = {
    actor: { id: usageId, role: "office" }, companyIds: new Set([workorderId]),
    companyRoles: new Map([[workorderId, "office"]]), locationIds: new Set([usageId]),
  };
  const result = await previewWorkorderPartPricing(workorderId, {
    usageKind: "serialized", usageId,
  }, context, {
    ...workorderAccess,
    readCreatePricing: async () => assert.fail("saved serialized pricing must not require an in-stock unit"),
    readPricingSource: async () => ({
      company_id: workorderId, location_id: usageId, catalog_part_id: usageId,
      part_number: "SERIAL-FILTER", uom_code: "ea", quantity: "1.000",
      unit_status: "reserved", allocations: [{
        costLayerId: usageId, receiptLineId: usageId, quantity: "1.000",
        unitCost: "7.2500", currency: "USD",
      }],
    }),
    readConfiguredSources: async () => ({
      configured_price_version_id: usageId, configured_amount: "8.5000",
      configured_currency: "USD", selling_policy_version_id: usageId,
      policy_method: "fixed", policy_value: "11.0000", policy_currency: "USD",
    }),
  });
  assert.equal(result.partNumber, "SERIAL-FILTER");
  assert.equal(result.options.batch_cost.price.unitPrice, "7.2500");
  assert.equal(result.options.batch_cost.price.receiptLineId, usageId);
  assert.deepEqual(result.options.batch_cost.price.allocations, []);
  assert.equal(result.options.internal_cost.price.configuredPriceVersionId, usageId);
  assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
});

test("selection rejects a stale preview before the snapshot repository runs", async () => {
  const context = { actor: { id: usageId, role: "office" }, companyIds: new Set([workorderId]),
    companyRoles: new Map([[workorderId, "office"]]), locationIds: new Set([usageId]) };
  await assert.rejects(() => selectWorkorderPartPrice(workorderId, input, context, {
    ...workorderAccess,
    previewPricing: async () => ({ fingerprint: "b".repeat(64), options: { batch_cost: { status: "known" } } }),
    savePartPrice: async () => assert.fail("stale selection reached persistence"),
  }), { code: "WORKORDER_PRICING_CHANGED", statusCode: 409 });
});

test("identical price command replay returns its immutable snapshot before current-rate validation", async () => {
  const context = { actor: { id: usageId, role: "office" }, companyIds: new Set([workorderId]),
    companyRoles: new Map([[workorderId, "office"]]), locationIds: new Set([usageId]) };
  const result = await selectWorkorderPartPrice(workorderId, input, context, {
    requireAccess: workorderAccess.requireAccess,
    readPriceReplay: async () => ({ kind: "saved", replayed: true, snapshot: { id: usageId, unitPrice: "8.0000" } }),
    previewPricing: async () => assert.fail("replay must not be blocked by a newer price"),
    savePartPrice: async () => assert.fail("replay must not insert another snapshot"),
  });
  assert.equal(result.replayed, true);
  assert.equal(result.snapshot.id, usageId);
});

for (const role of ["office", "admin"]) {
  test(`${role}: manual part amount reaches persistence and idempotency hash`, async () => {
    const context = { actor: { id: usageId, role }, companyIds: new Set([workorderId]),
      companyRoles: new Map([[workorderId, role]]), locationIds: new Set([usageId]) };
    const saved = [];
    const dependencies = { ...workorderAccess,
      previewPricing: async () => ({ fingerprint: expectedFingerprint, options: { batch_cost: { status: "known" } } }),
      savePartPrice: async (command) => { saved.push(command); return { kind: "saved" }; } };
    for (const customUnitPrice of ["0", "12.3456"]) {
      await selectWorkorderPartPrice(workorderId, { ...input, customUnitPrice }, context, dependencies);
    }
    assert.equal(saved[0].customUnitPrice, "0");
    assert.equal(saved[1].customUnitPrice, "12.3456");
    assert.notEqual(saved[0].requestHash, saved[1].requestHash);
    assert.equal(saved[0].actorId, usageId);
    await assert.rejects(() => selectWorkorderPartPrice(workorderId, input,
      { ...context, sessionMode: "kiosk" }, dependencies), { code: "WORKORDER_PART_PRICE_FORBIDDEN" });
  });
}
