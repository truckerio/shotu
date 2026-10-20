import assert from "node:assert/strict";
import test from "node:test";
import {
  laborCorrectionNeedsReason,
  laborEntryCanEdit,
  normalizeWorkLogView,
  workLogRequestError,
} from "./workorder-work-log-model.js";

test("work log normalizes the shared operational status choices and permissions", () => {
  const view = normalizeWorkLogView({ activityStatus: "active", version: 3, canChangeStatus: false, entries: null });
  assert.equal(view.activityStatus, "active");
  assert.equal(view.statusOptions.map(({ label }) => label).join("|"), "Ready to start|Active|On hold|Waiting for parts|Waiting for office");
  assert.equal(view.canChangeStatus, false);
  assert.deepEqual(view.entries, []);
});

test("labor edits allow the owner and managers and every correction requires a reason", () => {
  const entry = { mechanicUserId: "mechanic-1" };
  assert.equal(laborEntryCanEdit({ canLogLabor: true }, entry, "mechanic-1"), true);
  assert.equal(laborEntryCanEdit({ canLogLabor: true }, entry, "mechanic-2"), false);
  assert.equal(laborEntryCanEdit({ canManageLabor: true }, entry, "manager-1"), true);
  assert.equal(laborCorrectionNeedsReason({ canManageLabor: true }, entry, "manager-1"), true);
  assert.equal(laborCorrectionNeedsReason({ canManageLabor: true }, entry, "mechanic-1"), true);
  assert.equal(laborCorrectionNeedsReason({ canLogLabor: true }, entry, "mechanic-1"), true);
});

test("stale work-log errors tell the operator to refresh", () => {
  assert.match(workLogRequestError({ status: 409 }), /changed elsewhere/i);
});
