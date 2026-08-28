import assert from "node:assert/strict";
import test from "node:test";
import {
  LIFECYCLE_OPTIONS,
  buildPartRequestsQuery,
  buildOperationsQuery,
  operationLabel,
  normalizeOperationsCategoryFilters,
  operationsCategoryFromSearch,
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

test("Operations initializes only from valid queue routes", () => {
  assert.equal(operationsCategoryFromSearch("?adminView=operations&category=odoo_backlog"), "odoo_backlog");
  assert.equal(operationsCategoryFromSearch("?adminView=operations&category=unknown"), null);
  assert.equal(operationsCategoryFromSearch("?view=drafts&category=active"), "drafts");
  assert.equal(operationsCategoryFromSearch("?adminView=surveillance"), "odoo_backlog");
  assert.equal(operationsCategoryFromSearch(""), null);
});

test("Admin operations labels delegate canonical lifecycle wording to the shared registry", () => {
  assert.equal(operationLabel("mechanic_done"), "Work done");
  assert.equal(operationLabel("odoo_entered"), "Entered in Odoo");
  assert.equal(operationLabel("revision_requested"), "Mechanic changes requested");
  assert.equal(operationLabel("future_state", "Future state"), "Future state");
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

test("Part request query uses the shared Office queue contract", () => {
  const query = buildPartRequestsQuery({
    locationId: "location-1",
    search: " brake pad ",
    status: "requested",
    supply: "partial",
    sort: "waiting:desc",
  }, 3);

  assert.deepEqual(Object.fromEntries(query), {
    page: "3",
    pageSize: "50",
    sort: "waiting:desc",
    location: "location-1",
    search: "brake pad",
    status: "requested",
    supply: "partial",
  });
  assert.equal(query.toString(), "page=3&pageSize=50&sort=waiting%3Adesc&location=location-1&search=brake+pad&status=requested&supply=partial");
});

test("Part request query can request a count-only page without adding filters", () => {
  const query = buildPartRequestsQuery({
    locationId: "",
    search: "",
    status: "",
    supply: "",
    sort: "waiting:desc",
  }, 1, 1);

  assert.deepEqual(Object.fromEntries(query), {
    page: "1",
    pageSize: "1",
    sort: "waiting:desc",
  });
});
