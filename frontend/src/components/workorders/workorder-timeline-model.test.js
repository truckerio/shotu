import assert from "node:assert/strict";
import test from "node:test";
import {
  meaningfulTimelineEvents,
  timelineEventCount,
  timelineEventDescription,
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

test("multi-event timeline keeps distinct operational activity readable", () => {
  const events = [
    { id: 1, type: "status", from_status: "created", to_status: "assigned", note: "Assigned by office." },
    {
      id: 2,
      type: "assignment",
      action: "reassigned",
      from_mechanic_id: "mechanic-1",
      from_mechanic_name: "Alex",
      to_mechanic_name: "Jordan",
    },
    { id: 3, type: "field", field_key: "work_details_updated", new_value: "{\"fieldsChanged\":[\"diagnosis\"]}" },
    { id: 4, type: "part", action: "requested", note: "Brake chamber requested." },
  ];

  assert.equal(timelineEventCount(events), 4);
  assert.deepEqual(events.map(timelineEventTitle), [
    "Created to Assigned",
    "Mechanic reassigned",
    "Work details updated",
    "Part requested",
  ]);
  assert.deepEqual(events.map(timelineEventDescription), [
    "Assigned by office.",
    "Alex changed to Jordan.",
    "Diagnosis saved.",
    "Brake chamber requested.",
  ]);
});

test("used-parts activity formats quantity with its unit", () => {
  assert.equal(timelineEventDescription({
    type: "field",
    field_label: "Used parts",
    new_value: JSON.stringify([
      { partNo: "COOLANT", qty: "2.5", uomCode: "gal" },
      { partNo: "FILTER", qty: 1 },
    ]),
  }), "Used parts: 2.5 gal × COOLANT, 1 ea × FILTER.");
});
