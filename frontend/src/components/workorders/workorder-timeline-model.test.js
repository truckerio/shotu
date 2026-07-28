import assert from "node:assert/strict";
import test from "node:test";
import {
  meaningfulTimelineEvents,
  timelineEventCount,
  timelineEventDescription,
  timelineEventStatus,
  timelineEventTitle,
} from "./workorder-timeline-model.js";

test("lifecycle labels use human language while preserving status data", () => {
  const event = { type: "status", from_status: "created", to_status: "in_progress" };
  assert.equal(timelineEventTitle(event), "Work started");
  assert.equal(event.from_status, "created");
  assert.equal(event.to_status, "in_progress");
});

test("compact timeline count excludes access audit noise", () => {
  const auditTimeline = [
    { id: 1, type: "access" },
    { id: 2, type: "status", to_status: "completed" },
  ];
  assert.equal(meaningfulTimelineEvents(auditTimeline).length, 1);
  assert.equal(timelineEventCount(auditTimeline), 1);
  assert.equal(auditTimeline.length, 2, "display filtering must not mutate audit data");
});

test("timeline titles and descriptions use human labels without raw arrows", () => {
  const assignment = {
    type: "assignment",
    action: "reassigned",
    from_mechanic_id: "mechanic-1",
    from_mechanic_name: "Alex",
    to_mechanic_name: "Jordan",
  };
  assert.equal(timelineEventTitle(assignment), "Mechanic reassigned");
  assert.equal(timelineEventDescription(assignment), "Alex changed to Jordan.");
  assert.equal(timelineEventDescription({
    type: "field",
    field_label: "Mileage",
    old_value: "100",
    new_value: "125",
  }), "Mileage updated to 125.");
  assert.equal(timelineEventDescription(assignment).includes("->"), false);
});

test("status metadata keeps lifecycle state visible beside human event copy", () => {
  assert.equal(timelineEventStatus({
    type: "status",
    from_status: "assigned",
    to_status: "in_progress",
  }), "Work started");
  assert.equal(timelineEventStatus({ type: "assignment", action: "accepted" }), "");
});
