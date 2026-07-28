import test from "node:test";
import assert from "node:assert/strict";
import {
  SURVEILLANCE_PHONE_PRIMARY_TABS,
  SURVEILLANCE_PHONE_SECONDARY_TABS,
  isSurveillancePhonePrimaryTab,
} from "./surveillanceQueue.js";

test("phone surveillance prioritizes Odoo entry and issue queues", () => {
  assert.deepEqual(SURVEILLANCE_PHONE_PRIMARY_TABS.map(({ key }) => key), [
    "pendingOdoo",
    "entered",
    "missingInfo",
  ]);
});

test("operational queues remain available as secondary views", () => {
  assert.deepEqual(SURVEILLANCE_PHONE_SECONDARY_TABS.map(({ key }) => key), [
    "active",
    "awaitingOffice",
  ]);
  assert.equal(isSurveillancePhonePrimaryTab("pendingOdoo"), true);
  assert.equal(isSurveillancePhonePrimaryTab("active"), false);
});
