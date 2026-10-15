import assert from "node:assert/strict";
import test from "node:test";
import { mileageState, normalizeMileage, validateManualMileage } from "./asset-mileage.js";

test("mileage state distinguishes fresh, stale, unknown, and conflict", () => {
  const now = new Date("2026-10-14T12:00:00.000Z");
  assert.equal(mileageState({ miles: 100, observedAt: "2026-10-14T11:00:00.000Z", now }), "fresh");
  assert.equal(mileageState({ miles: 100, observedAt: "2026-10-12T11:00:00.000Z", now }), "stale");
  assert.equal(mileageState({ miles: null, observedAt: null, now }), "unknown");
  assert.equal(mileageState({ miles: 100, observedAt: "2026-10-15T12:00:00.000Z", now }), "unknown");
  assert.equal(mileageState({ miles: 100, observedAt: now, conflict: true, now }), "conflict");
});

test("missing and coercion-prone mileage values are invalid", () => {
  assert.equal(normalizeMileage(null), null);
  assert.equal(normalizeMileage(undefined), null);
  assert.equal(normalizeMileage(""), null);
  assert.equal(normalizeMileage("   "), null);
  assert.equal(normalizeMileage(false), null);
  assert.equal(normalizeMileage("0"), 0);
});

test("manual mileage rejects invalid and unexplained backwards readings", () => {
  const now = new Date("2026-10-14T12:00:00.000Z");
  assert.throws(() => validateManualMileage({ miles: -1, observedAt: now, reason: "entry", now }), { code: "ASSET_MILEAGE_INVALID" });
  assert.throws(() => validateManualMileage({ miles: 800, currentMiles: 1000, observedAt: now, reason: "entered", now }), { code: "ASSET_MILEAGE_BACKWARDS" });
  assert.equal(validateManualMileage({ miles: 800, currentMiles: 1000, observedAt: now, reason: "Dashboard verified correction", now }).miles, 800);
});
