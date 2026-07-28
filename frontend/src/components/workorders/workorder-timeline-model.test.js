import assert from "node:assert/strict";
import test from "node:test";
import { meaningfulTimelineEvents, timelineEventTitle } from "./workorder-timeline-model.js";

test("lifecycle labels use human language while preserving status data", () => {
  const event = { type: "status", from_status: "created", to_status: "in_progress" };
  assert.equal(timelineEventTitle(event), "Work started");
  assert.equal(event.from_status, "created");
  assert.equal(event.to_status, "in_progress");
});

test("compact timeline count excludes access audit noise", () => {
  assert.equal(meaningfulTimelineEvents([
    { id: 1, type: "access" },
    { id: 2, type: "status", to_status: "completed" },
  ]).length, 1);
});
