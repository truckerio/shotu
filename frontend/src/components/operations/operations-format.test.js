import assert from "node:assert/strict";
import test from "node:test";
import { LIFECYCLE_OPTIONS, buildOperationsQuery } from "./operations-format.js";

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
