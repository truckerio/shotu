import assert from "node:assert/strict";
import test from "node:test";
import {
  groupTimelineEvents,
  timelineConcernDetails,
  timelineConcernRevision,
  meaningfulTimelineEvents,
  timelineEventCount,
  timelineEventDescription,
  timelineEventTitle,
} from "./workorder-timeline-model.js";

function usedPartsEvent({
  id,
  actorId = "user-1",
  actorName = "Karan",
  actorRole = "admin",
  createdAt,
  parts,
}) {
  return {
    id,
    type: "field",
    field_key: "formData.parts",
    field_label: "Used parts",
    actor_user_id: actorId,
    changed_by_name: actorName,
    actor_role: actorRole,
    created_at: createdAt,
    new_value: JSON.stringify(parts),
  };
}

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

test("manual Workorder price overrides show the original and custom values", () => {
  const event = {
    type: "field",
    field_key: "pricing.part.0",
    field_label: "FILTER-1 price",
    old_value: "$18.00 internal price",
    new_value: "$24.00 custom price",
  };
  assert.equal(timelineEventTitle(event), "Workorder price changed");
  assert.equal(timelineEventDescription(event), "FILTER-1 price changed from $18.00 internal price to $24.00 custom price.");
});

test("price activity preserves exact four-decimal amounts, actor and timestamp", () => {
  const event = {
    id: "price-1", type: "field", field_key: "pricing.part.aggregate.line-1",
    field_label: "FILTER-1 price", old_value: "USD 18.1234 selling price",
    new_value: "USD 24.5678 custom price (selling price)",
    actor_user_id: "office-1", changed_by_name: "Office User", actor_role: "office",
    created_at: "2026-10-20T12:34:56.000Z",
  };
  assert.equal(timelineEventDescription(event), "FILTER-1 price changed from USD 18.1234 selling price to USD 24.5678 custom price (selling price).");
  const [group] = groupTimelineEvents([event]);
  assert.equal(group.actorName, "Office User");
  assert.equal(group.actorRole, "office");
  assert.equal(group.children[0].created_at, event.created_at);
  const initial = { ...event, old_value: "" };
  assert.equal(timelineEventTitle(initial), "Workorder price recorded");
  assert.equal(timelineEventDescription(initial), "FILTER-1 price recorded as USD 24.5678 custom price (selling price).");
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
  }), "Used parts: 2.5 gal × COOLANT, 1 pc × FILTER.");
});

test("serialized inventory activity keeps exact identity and approval semantics", () => {
  const reserved = {
    type: "part",
    action: "reserved",
    part_number: "FLT-22",
    serial_number: "SN-007",
  };
  const returned = {
    type: "part",
    action: "returned",
    partNumber: "FLT-22",
    serialNumber: "SN-007",
  };
  const removed = {
    type: "part",
    action: "removed_returned_to_stock",
    partNumber: "FLT-22",
    serialNumber: "SN-007",
  };
  const consumed = { type: "part", action: "installed", part_number: "FLT-22" };

  assert.equal(timelineEventTitle(reserved), "Part reserved");
  assert.equal(timelineEventDescription(reserved), "FLT-22 · SN-007: Reserved for this workorder; inventory is pending Office approval.");
  assert.equal(timelineEventTitle(returned), "Part returned unused");
  assert.equal(timelineEventDescription(returned), "FLT-22 · SN-007: Returned unused to available stock.");
  assert.equal(timelineEventTitle(removed), "Part removed from unit");
  assert.equal(timelineEventDescription(removed), "FLT-22 · SN-007: Removed from unit and physically returned to available stock.");
  assert.equal(timelineEventDescription(consumed), "FLT-22: Consumed after Office approval.");
});

test("same actor and event family group inside the inclusive two-minute activity window", () => {
  const events = [
    usedPartsEvent({
      id: "part-1",
      createdAt: "2026-08-03T19:15:00.000Z",
      parts: [{ partNo: "4", qty: "" }],
    }),
    usedPartsEvent({
      id: "part-2",
      createdAt: "2026-08-03T19:16:30.000Z",
      parts: [{ partNo: "46305", qty: "" }],
    }),
    usedPartsEvent({
      id: "part-3",
      createdAt: "2026-08-03T19:18:30.000Z",
      parts: [{ partNo: "46305", qty: 1, uomCode: "ea" }],
    }),
  ];

  const groups = groupTimelineEvents(events);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].childCount, 3);
  assert.equal(groups[0].actorName, "Karan");
  assert.equal(groups[0].actorRole, "admin");
  assert.equal(groups[0].createdAt, events[2].created_at);
  assert.equal(groups[0].title, "Used parts changed");
  assert.equal(groups[0].description, "Used parts: 1 ea × 46305.");
});

test("actor, family, time, and adjacency boundaries keep activity parents separate", () => {
  const first = usedPartsEvent({
    id: "part-1",
    createdAt: "2026-08-03T19:15:00.000Z",
    parts: [{ partNo: "4", qty: "" }],
  });
  const otherActor = usedPartsEvent({
    id: "other-actor",
    actorId: "user-2",
    actorName: "Abhay",
    actorRole: "mechanic",
    createdAt: "2026-08-03T19:15:30.000Z",
    parts: [{ partNo: "FILTER", qty: 1 }],
  });
  const otherFamily = {
    id: "mileage",
    type: "field",
    field_key: "formData.mileage",
    field_label: "Mileage",
    actor_user_id: "user-1",
    changed_by_name: "Karan",
    actor_role: "admin",
    created_at: "2026-08-03T19:15:30.000Z",
    new_value: "505230",
  };
  const insideWindow = usedPartsEvent({
    id: "part-2",
    createdAt: "2026-08-03T19:16:00.000Z",
    parts: [{ partNo: "46", qty: "" }],
  });
  const outsideWindow = usedPartsEvent({
    id: "later-part",
    createdAt: "2026-08-03T19:17:01.000Z",
    parts: [{ partNo: "FINAL", qty: 1 }],
  });

  assert.equal(groupTimelineEvents([first, otherActor]).length, 2, "different actors never merge");
  assert.equal(groupTimelineEvents([first, otherFamily]).length, 2, "different field families never merge");
  assert.equal(groupTimelineEvents([first, outsideWindow]).length, 2, "a gap over two minutes starts a new parent");
  assert.equal(
    groupTimelineEvents([first, otherFamily, insideWindow]).length,
    3,
    "only consecutive events can join a parent",
  );
});

test("group parents preserve every raw child exactly once and summarize final committed state", () => {
  const access = {
    id: "opened",
    type: "access",
    actor_user_id: "user-1",
    created_at: "2026-08-03T19:14:00.000Z",
  };
  const first = usedPartsEvent({
    id: "draft",
    createdAt: "2026-08-03T19:15:00.000Z",
    parts: [{ partNo: "43", qty: "" }],
  });
  const final = usedPartsEvent({
    id: "final",
    createdAt: "2026-08-03T19:16:00.000Z",
    parts: [{ partNo: "GRO-54362", qty: 2, uomCode: "ea" }],
  });
  const status = {
    id: "done",
    type: "status",
    actor_user_id: "user-1",
    changed_by_name: "Karan",
    actor_role: "admin",
    created_at: "2026-08-03T19:17:00.000Z",
    from_status: "in_progress",
    to_status: "mechanic_done",
    note: "Work verified.",
  };
  const timeline = [access, first, final, status];
  const groups = groupTimelineEvents(timeline);

  assert.equal(timelineEventCount(timeline), 2, "Activity count represents parent actions");
  assert.deepEqual(groups.flatMap(({ children }) => children), [first, final, status]);
  assert.strictEqual(groups[0].children[0], first, "raw audit event objects must not be rewritten");
  assert.strictEqual(groups[0].children[1], final, "raw final event must remain available for expansion");
  assert.equal(groups[0].description, "Used parts: 2 ea × GRO-54362.");
  assert.equal(groups[1].description, "Work verified.");
  assert.deepEqual(timeline, [access, first, final, status], "grouping must not mutate source audit data");
});

test("Concern revisions show original and full before/after without changing actor grouping", () => {
  const initial = { id: "initial", type: "field", field_key: "concern.initial", old_value: "", new_value: "Driver reports air leak.\nAt idle.", actor_user_id: "office", changed_by_name: "Office", actor_role: "office", created_at: "2026-10-17T10:00:00Z" };
  const edits = [1, 2].map((id) => ({ id, type: "field", field_key: "concern", old_value: id === 1 ? initial.new_value : "Mechanic found hose leak", new_value: id === 1 ? "Mechanic found hose leak" : "Leak confirmed\nHose split", actor_user_id: "mechanic", changed_by_name: "Mechanic", actor_role: "mechanic", created_at: `2026-10-17T10:01:0${id}Z` }));
  assert.equal(timelineEventTitle(initial), "Concern recorded");
  assert.deepEqual(timelineConcernDetails(initial), [{ label: "Original concern", value: initial.new_value }]);
  assert.deepEqual(timelineConcernDetails(edits[0]), [{ label: "Before", value: initial.new_value }, { label: "After", value: "Mechanic found hose leak" }]);
  assert.equal(timelineEventDescription(edits[0]), "");
  const groups = groupTimelineEvents([initial, ...edits]);
  assert.equal(groups.length, 2);
  assert.equal(groups[1].childCount, 2);
  assert.deepEqual(groups[1].children.map((event) => timelineConcernDetails(event)[1].value), edits.map((event) => event.new_value));
  assert.equal(groups[1].actorName, "Mechanic");
});

test("legacy progress concern uses recorded baseline only and retains other progress descriptions", () => {
  const legacy = { type: "field", field_key: "work_details_updated", old_value: "{}", new_value: JSON.stringify({ fieldsChanged: ["concern"], concern: "Mechanic findings" }) };
  assert.equal(timelineConcernDetails(legacy)[0].value, "Not recorded");
  const known = { ...legacy, old_value: JSON.stringify({ concern: "Driver report" }) };
  assert.equal(timelineConcernRevision(known).before, "Driver report");
  const mixed = { ...known, new_value: JSON.stringify({ fieldsChanged: ["concern", "diagnosis"], concern: "Finding", diagnosis: "Leak" }) };
  assert.equal(timelineEventDescription(mixed), "Diagnosis saved.");
  assert.equal(timelineConcernDetails(mixed)[1].value, "Finding");
  assert.deepEqual(timelineConcernDetails({ ...legacy, new_value: "not json" }), []);
  assert.equal(timelineConcernDetails({ ...known, old_value: JSON.stringify({ concern: "" }) })[0].value, "Empty");
});
