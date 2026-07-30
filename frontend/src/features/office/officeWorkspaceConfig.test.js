import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFICE_PRIMARY_TABS,
  OFFICE_SECONDARY_TAB_KEYS,
  needsOfficeAction,
  officeHandoffSummary,
  officeQueueFilterState,
  officeTabForMechanicFilter,
  officeUrgency,
  officeRowsForTab,
} from "./officeWorkspaceConfig.js";

test("phone office queues expose decision-first buckets", () => {
  assert.deepEqual(OFFICE_PRIMARY_TABS.map(({ key, label }) => ({ key, label })), [
    { key: "needs", label: "Needs action" },
    { key: "active", label: "In progress" },
    { key: "doneOdoo", label: "Done / Odoo" },
  ]);
  assert.deepEqual(OFFICE_SECONDARY_TAB_KEYS, ["open", "parts", "drafts", "all", "closed"]);
});

test("Manager Needs action includes and prioritizes cross-role handoffs", () => {
  const missingInfo = {
    id: "missing",
    lifecycle: "closed",
    attentionReasons: ["missing_info"],
    attentionDetails: { missing_info: { note: "Add the authorization name." } },
  };
  const revision = { id: "revision", lifecycle: "in_progress", attentionReasons: ["revision_requested"] };
  const ordinary = { id: "active", lifecycle: "in_progress", attentionReasons: [] };

  assert.equal(needsOfficeAction(missingInfo), true);
  assert.equal(needsOfficeAction(revision), true);
  assert.equal(needsOfficeAction(ordinary), false);
  assert.ok(officeUrgency(missingInfo) < officeUrgency(revision));
  assert.deepEqual(officeHandoffSummary(missingInfo), {
    reason: "missing_info",
    label: "Surveillance needs information",
    note: "Add the authorization name.",
  });
  assert.deepEqual(officeHandoffSummary(revision), {
    reason: "revision_requested",
    label: "Changes requested from mechanic",
    note: "",
  });
});

test("done and Odoo queue combines review and closed work without duplicates", () => {
  const review = { id: "review" };
  const duplicate = { id: "duplicate" };
  const closed = { id: "closed" };
  const dashboard = { done: [review, duplicate], closed: [duplicate, closed] };

  assert.deepEqual(
    officeRowsForTab("doneOdoo", dashboard, [], []).map(({ id }) => id),
    ["review", "duplicate", "closed"],
  );
});

test("Unassigned queue cannot retain filters that exclude every unassigned row", () => {
  assert.deepEqual(officeQueueFilterState("open", {
    lifecycleFilter: "accepted",
    mechanicFilter: "Anmol",
  }), {
    activeTab: "open",
    lifecycleFilter: "",
    mechanicFilter: "",
  });
  assert.deepEqual(officeQueueFilterState("active", {
    lifecycleFilter: "closed",
    mechanicFilter: "Anmol",
  }), {
    activeTab: "active",
    lifecycleFilter: "",
    mechanicFilter: "Anmol",
  });
  assert.equal(officeQueueFilterState("active", { lifecycleFilter: "accepted" }).lifecycleFilter, "accepted");
  assert.equal(officeQueueFilterState("closed", { lifecycleFilter: "mechanic_done" }).lifecycleFilter, "");
  assert.equal(officeTabForMechanicFilter("open", "Anmol"), "all");
  assert.equal(officeTabForMechanicFilter("open", ""), "open");
});
