import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalApprovalName,
  canonicalPreviewTimes,
  earliestAssignmentAt,
  formatHandoffTimestamp,
  workorderHandoffFacts,
} from "./workorder-handoff.js";

test("canonical preview times override saved form snapshots", () => {
  const workorder = {
    startedAt: "2026-07-29T15:04:00.000Z",
    mechanicDoneAt: "2026-07-29T18:42:00.000Z",
  };
  const result = canonicalPreviewTimes(workorder);
  assert.match(result.startTime, /^\d{2}:\d{2}$/);
  assert.match(result.endTime, /^\d{2}:\d{2}$/);
  assert.notEqual(result.startTime, "01:01");
});

test("handoff timestamps stay empty when canonical values are absent", () => {
  assert.deepEqual(canonicalPreviewTimes({}), { startTime: "", endTime: "" });
  assert.equal(formatHandoffTimestamp(null), "Not recorded");
});

test("assigned time uses the earliest current assignment and approval stays attributable", () => {
  const workorder = {
    acceptedAt: "2026-07-29T12:00:00.000Z",
    mechanics: [
      { assignedAt: "2026-07-29T13:00:00.000Z" },
      { assignedAt: "2026-07-29T12:30:00.000Z" },
    ],
    closedAt: "2026-07-29T18:00:00.000Z",
    approvedByName: "Office One",
  };
  assert.equal(earliestAssignmentAt(workorder), "2026-07-29T12:30:00.000Z");
  assert.equal(canonicalApprovalName(workorder), "Office One");
  assert.equal(workorderHandoffFacts(workorder).at(-1).detail, "Office One");
});

test("canonical approval identity prefers the structured actor", () => {
  assert.equal(canonicalApprovalName({
    approvedBy: { id: "office-id", name: "Manager Two" },
    approvedByName: "Legacy Manager",
  }), "Manager Two");
  assert.equal(canonicalApprovalName({}), "");
});
