import assert from "node:assert/strict";
import test from "node:test";
import {
  eligibleSelectedUnitIds,
  formatPriceAmount,
  issueSelectedSerializedUnits,
  missingPriceLabel,
  selectAllEligibleUnitIds,
  serializedPriceSourceOptions,
  serializedPricingSelection,
} from "./workorder-serialized-part-selection.js";

const units = [
  { id: "unit-1" },
  { id: "unit-2", eligible: false },
  { id: "unit-3" },
  { id: "unit-4", eligibility: { canIssue: false } },
];

test("selection helpers retain only eligible visible serialized units", () => {
  assert.deepEqual([...selectAllEligibleUnitIds(units)], ["unit-1", "unit-3"]);
  assert.deepEqual(eligibleSelectedUnitIds(units, new Set(["unit-1", "unit-2", "unit-4"])), ["unit-1"]);
});

test("missing price labels stay concise for narrow source menus", () => {
  assert.equal(missingPriceLabel("batch_cost"), "Cost not recorded");
  assert.equal(missingPriceLabel("internal_cost"), "Not configured");
  assert.equal(missingPriceLabel("selling_price"), "Not configured");
});

test("serialized pricing requires a known server option and fingerprint for every chosen unit", () => {
  const previews = {
    "unit-1": { fingerprint: "one", options: { batch_cost: { status: "known", price: { totalPrice: 12, currency: "USD" } } } },
    "unit-3": { fingerprint: "three", options: { batch_cost: { status: "known", price: { totalPrice: 18, currency: "USD" } }, selling_price: { status: "incomplete", reason: "Configure selling price" } } },
  };
  assert.deepEqual(serializedPricingSelection(previews, ["unit-1", "unit-3"], "batch_cost").map(({ unitId, fingerprint }) => ({ unitId, fingerprint })), [
    { unitId: "unit-1", fingerprint: "one" },
    { unitId: "unit-3", fingerprint: "three" },
  ]);
  assert.equal(serializedPricingSelection(previews, ["unit-1", "unit-3"], "selling_price"), null);
  const options = serializedPriceSourceOptions(previews, ["unit-1", "unit-3"], "en-US");
  assert.equal(options.find(({ value }) => value === "batch_cost").amount, "$30.00");
  assert.equal(options.find(({ value }) => value === "selling_price").disabled, true);
});

test("serialized source totals reject zero selections and mixed currencies", () => {
  const emptyOptions = serializedPriceSourceOptions({}, [], "en-US");
  assert.equal(emptyOptions.find(({ value }) => value === "batch_cost").disabled, true);
  assert.equal(emptyOptions.find(({ value }) => value === "batch_cost").amount, "Select a serial number");

  const mixed = {
    "unit-1": { fingerprint: "one", options: { batch_cost: { status: "known", price: { totalPrice: 12, currency: "USD" } } } },
    "unit-3": { fingerprint: "three", options: { batch_cost: { status: "known", price: { totalPrice: 18, currency: "CAD" } } } },
  };
  const mixedOption = serializedPriceSourceOptions(mixed, ["unit-1", "unit-3"], "en-US").find(({ value }) => value === "batch_cost");
  assert.equal(mixedOption.disabled, true);
  assert.equal(mixedOption.amount, "Mixed currencies");
  assert.equal(serializedPricingSelection(mixed, ["unit-1", "unit-3"], "batch_cost"), null);
});

test("price formatting requires server currency and preserves four-decimal rates", () => {
  assert.equal(formatPriceAmount({ unitPrice: 12.3456, currency: "USD" }, "en-US"), "$12.3456");
  assert.equal(formatPriceAmount({ unitPrice: 12.3456 }, "en-US"), "Missing price");
  assert.equal(formatPriceAmount({ unitPrice: null, currency: "USD" }, "en-US"), "Missing price");
  assert.equal(serializedPricingSelection({
    "unit-1": { fingerprint: "one", options: { batch_cost: { status: "known", price: { unitPrice: null, currency: "USD" } } } },
  }, ["unit-1"], "batch_cost"), null);
});

test("selected serialized units issue in order with distinct stable keys and record every success", async () => {
  const keys = new Map();
  const calls = [];
  const recorded = [];
  const createKey = (unitId) => `key-${unitId}`;

  const first = await issueSelectedSerializedUnits({
    units,
    selectedUnitIds: new Set(["unit-1", "unit-3"]),
    keyByUnitId: keys,
    createKey,
    issue: async (unitId, idempotencyKey) => {
      calls.push([unitId, idempotencyKey]);
      return { usage: unitId };
    },
    onIssued: async (result, unitId) => recorded.push([result.usage, unitId]),
  });

  assert.deepEqual(calls, [["unit-1", "key-unit-1"], ["unit-3", "key-unit-3"]]);
  assert.deepEqual(recorded, [["unit-1", "unit-1"], ["unit-3", "unit-3"]]);
  assert.deepEqual(first.successes, ["unit-1", "unit-3"]);
  assert.deepEqual(first.failures, []);
  assert.notEqual(keys.get("unit-1"), keys.get("unit-3"));
});

test("a failure does not stop later units; retry keeps its key and never reissues prior successes", async () => {
  const keys = new Map();
  const calls = [];
  let unit1Attempts = 0;
  const issue = async (unitId, idempotencyKey) => {
    calls.push([unitId, idempotencyKey]);
    if (unitId === "unit-1" && unit1Attempts++ === 0) throw new Error("offline");
    return { usage: unitId };
  };
  const options = {
    units,
    keyByUnitId: keys,
    createKey: (unitId) => `key-${unitId}`,
    issue,
  };

  const first = await issueSelectedSerializedUnits({ ...options, selectedUnitIds: new Set(["unit-1", "unit-3"]) });
  const retry = await issueSelectedSerializedUnits({ ...options, selectedUnitIds: new Set(first.failures.map(({ id }) => id)) });

  assert.deepEqual(first.successes, ["unit-3"]);
  assert.deepEqual(first.failures.map(({ id }) => id), ["unit-1"]);
  assert.deepEqual(retry.successes, ["unit-1"]);
  assert.deepEqual(retry.failures, []);
  assert.deepEqual(calls, [["unit-1", "key-unit-1"], ["unit-3", "key-unit-3"], ["unit-1", "key-unit-1"]]);
});
