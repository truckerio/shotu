import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFICE_PRIMARY_TABS,
  OFFICE_SECONDARY_TAB_KEYS,
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
