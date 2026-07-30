import assert from "node:assert/strict";
import test from "node:test";
import {
  LIFECYCLE_OPTIONS,
  buildOperationsQuery,
  normalizeOperationsCategoryFilters,
} from "./operations-format.js";

test("Admin lifecycle filter exposes every canonical state", () => {
  assert.deepEqual(LIFECYCLE_OPTIONS, [
    ["", "All lifecycle states"],
    ["open", "Open"],
    ["accepted", "Accepted"],
    ["in_progress", "In progress"],
    ["mechanic_done", "Work done"],
    ["closed", "Closed"],
    ["odoo_entered", "Entered in Odoo"],
    ["cancelled", "Cancelled"],
  ]);
});

test("Admin lifecycle selection is sent to the operations API", () => {
  for (const [lifecycle] of LIFECYCLE_OPTIONS) {
    const query = buildOperationsQuery({
      category: "active",
      locationId: "",
      lifecycle,
      attentionReason: "",
      search: "",
      sort: "timeInStatus:desc",
    }, 1);
    assert.equal(query.get("lifecycle"), lifecycle || null);
    assert.equal(query.get("category"), "active");
  }
});

test("Admin category changes discard only incompatible lifecycle refinements", () => {
  assert.equal(
    normalizeOperationsCategoryFilters("unassigned", { lifecycle: "accepted" }).lifecycle,
    "",
  );
  assert.equal(
    normalizeOperationsCategoryFilters("active", { lifecycle: "accepted" }).lifecycle,
    "accepted",
  );
  assert.equal(
    normalizeOperationsCategoryFilters("ready_review", { lifecycle: "closed" }).lifecycle,
    "",
  );
  assert.equal(
    normalizeOperationsCategoryFilters("all", { lifecycle: "closed" }).lifecycle,
    "closed",
  );
});
