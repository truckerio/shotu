import assert from "node:assert/strict";
import test from "node:test";
import {
  MECHANIC_ACTIVE_LIFECYCLES,
  MECHANIC_HISTORY_LIFECYCLES,
  ODOO_ELIGIBLE_LIFECYCLES,
  OPERATIONS_ACTIVE_LIFECYCLES,
  SURVEILLANCE_VISIBLE_LIFECYCLES,
  WORKORDER_LIFECYCLES,
} from "./workorder-lifecycle-policy.js";

test("canonical lifecycle includes every filterable state exactly once", () => {
  assert.deepEqual(WORKORDER_LIFECYCLES, [
    "open",
    "accepted",
    "in_progress",
    "mechanic_done",
    "closed",
    "odoo_entered",
    "cancelled",
  ]);
  assert.equal(new Set(WORKORDER_LIFECYCLES).size, WORKORDER_LIFECYCLES.length);
});

test("operations Active includes Work done while preserving its review queue", () => {
  assert.deepEqual(OPERATIONS_ACTIVE_LIFECYCLES, ["accepted", "in_progress", "mechanic_done"]);
});

test("role lifecycle boundaries do not expose irrelevant states", () => {
  assert.deepEqual(MECHANIC_ACTIVE_LIFECYCLES, ["accepted", "in_progress"]);
  assert.deepEqual(MECHANIC_HISTORY_LIFECYCLES, ["mechanic_done", "closed", "odoo_entered"]);
  assert.deepEqual(SURVEILLANCE_VISIBLE_LIFECYCLES, [
    "accepted",
    "in_progress",
    "mechanic_done",
    "closed",
    "odoo_entered",
  ]);
  assert.deepEqual(ODOO_ELIGIBLE_LIFECYCLES, ["closed", "odoo_entered"]);
  assert.equal(SURVEILLANCE_VISIBLE_LIFECYCLES.includes("open"), false);
  assert.equal(SURVEILLANCE_VISIBLE_LIFECYCLES.includes("cancelled"), false);
  assert.equal(MECHANIC_HISTORY_LIFECYCLES.includes("cancelled"), false);
});
