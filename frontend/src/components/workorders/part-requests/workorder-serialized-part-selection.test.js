import assert from "node:assert/strict";
import test from "node:test";
import {
  eligibleSelectedUnitIds,
  issueSelectedSerializedUnits,
  selectAllEligibleUnitIds,
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
