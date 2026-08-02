import assert from "node:assert/strict";
import test from "node:test";
import {
  activeDatePreset,
  buildCompactSurveillanceTabs,
  buildSurveillanceTabs,
  datePresetRange,
  matchesDateFilter,
  missingFields,
  progressTimestamp,
  surveillanceLocations,
} from "./surveillance-workspace-model.js";

test("queue projection keeps canonical queues, counts, and phone labels", () => {
  const tabs = buildSurveillanceTabs({ active: 3, pendingOdoo: 2 });
  assert.deepEqual(tabs.map(({ key, count }) => [key, count]), [
    ["active", 3],
    ["awaitingOffice", 0],
    ["pendingOdoo", 2],
    ["missingInfo", 0],
    ["entered", 0],
  ]);
  assert.deepEqual(buildCompactSurveillanceTabs(tabs).map(({ key, label }) => [key, label]), [
    ["pendingOdoo", "Needs Odoo"],
    ["entered", "Entered"],
    ["missingInfo", "Missing info"],
  ]);
});

test("date filters support single dates, normalized ranges, and presets", () => {
  const now = new Date("2026-08-02T12:00:00-07:00");
  assert.equal(matchesDateFilter("2026-08-02T10:00:00-07:00", "2026-08-02", ""), true);
  assert.equal(matchesDateFilter("2026-08-01T10:00:00-07:00", "2026-08-02", ""), false);
  assert.equal(matchesDateFilter("2026-08-01T10:00:00-07:00", "2026-08-02", "2026-07-31"), true);
  const today = datePresetRange("today", now);
  assert.equal(activeDatePreset(today.start, today.end, now), "today");
  const week = datePresetRange("week", now);
  assert.equal(activeDatePreset(week.start, week.end, now), "week");
});

test("location, missing-information, and progress projections remain stable", () => {
  assert.deepEqual(surveillanceLocations({
    active: [{ locationName: "Texas" }, { locationName: "Chino" }],
    pendingOdoo: [{ locationName: "Chino" }],
  }), ["Chino", "Texas"]);
  assert.deepEqual(missingFields({ concern: "Inspect", diagnosis: "Found", workPerformed: "Fixed", asset: { unitNo: "101" }, mechanics: [{ name: "M" }] }), []);
  assert.deepEqual(progressTimestamp({ status: "in_progress", startedAt: "start", acceptedAt: "accepted" }), { label: "Started", value: "start" });
});
