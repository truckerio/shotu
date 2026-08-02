import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKORDER_LIFECYCLE_LABELS,
  WORKORDER_LIFECYCLES,
  formatLifecycleLabel,
  formatUiDate,
  formatUiDateRange,
  formatUiDateTime,
} from "./workorder-presentation.js";

test("lifecycle presentation has one canonical label for every persisted state", () => {
  assert.deepEqual(WORKORDER_LIFECYCLE_LABELS, {
    open: "Open",
    accepted: "Accepted",
    in_progress: "In progress",
    mechanic_done: "Work done",
    closed: "Closed",
    odoo_entered: "Entered in Odoo",
    cancelled: "Cancelled",
  });
  assert.deepEqual(WORKORDER_LIFECYCLES, Object.keys(WORKORDER_LIFECYCLE_LABELS));
});

test("open becomes Unassigned only when its queue explicitly requests that context", () => {
  assert.equal(formatLifecycleLabel("open"), "Open");
  assert.equal(formatLifecycleLabel("open", { openAsUnassigned: true }), "Unassigned");
  assert.equal(formatLifecycleLabel("mechanic_done", { openAsUnassigned: true }), "Work done");
  assert.equal(formatLifecycleLabel("legacy", { fallback: "Legacy state" }), "Legacy state");
});

test("UI dates are localized and date-only values do not shift across timezones", () => {
  assert.equal(formatUiDate("2026-08-01", { locale: "en-US", timeZone: "America/Los_Angeles" }), "Aug 1, 2026");
  assert.equal(
    formatUiDateTime("2026-08-01T19:05:00Z", { locale: "en-US", timeZone: "UTC" }),
    "Aug 1, 2026, 7:05 PM",
  );
});

test("UI date helpers fail gracefully for empty and invalid values", () => {
  for (const value of [null, undefined, "", "not-a-date", "2026-02-31", new Date("invalid")]) {
    assert.equal(formatUiDate(value), "");
    assert.equal(formatUiDateTime(value), "");
  }
});

test("UI date ranges collapse equal dates and format distinct dates consistently", () => {
  assert.equal(formatUiDateRange("2026-08-01", "2026-08-01", { locale: "en-US" }), "Aug 1, 2026");
  assert.equal(formatUiDateRange("2026-08-01", "2026-08-03", { locale: "en-US" }), "Aug 1, 2026 – Aug 3, 2026");
  assert.equal(formatUiDateRange("", "2026-08-03", { locale: "en-US" }), "Aug 3, 2026");
});
