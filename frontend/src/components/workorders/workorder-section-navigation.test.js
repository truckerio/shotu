import assert from "node:assert/strict";
import test from "node:test";
import { fitWorkorderSections, splitWorkorderSections } from "./workorder-section-navigation.js";

const sections = [
  { id: "concern" },
  { id: "diagnosisRepair" },
  { id: "chat" },
  { id: "parts" },
  { id: "assignment", priority: 20 },
  { id: "completion", alwaysPrimary: true },
  { id: "activity", overflow: true },
];

const sectionWidths = {
  concern: 80,
  diagnosisRepair: 160,
  chat: 60,
  parts: 65,
  assignment: 100,
  completion: 105,
  activity: 80,
};

test("phone navigation keeps four destinations plus More", () => {
  const result = splitWorkorderSections(sections);
  assert.deepEqual(result.primarySections.map(({ id }) => id), ["concern", "diagnosisRepair", "assignment", "completion"]);
  assert.deepEqual(result.overflowSections.map(({ id }) => id), ["chat", "parts", "activity"]);
});

test("phone navigation uses priority without changing visible section order", () => {
  const result = splitWorkorderSections([
    { id: "location", alwaysPrimary: true, priority: 60 },
    { id: "schedule", alwaysPrimary: true, priority: 50 },
    { id: "concern", alwaysPrimary: true, priority: 40 },
    { id: "unit", alwaysPrimary: true, priority: 30 },
    { id: "assignment", alwaysPrimary: true, priority: 20 },
  ]);
  assert.deepEqual(result.primarySections.map(({ id }) => id), ["location", "schedule", "concern", "unit"]);
  assert.deepEqual(result.overflowSections.map(({ id }) => id), ["assignment"]);
});

test("desktop navigation shows every permitted section when all labels fit", () => {
  const result = fitWorkorderSections(sections, {
    availableWidth: 800,
    sectionWidths,
    moreWidth: 75,
  });
  assert.deepEqual(result.primarySections.map(({ id }) => id), sections.map(({ id }) => id));
  assert.deepEqual(result.overflowSections, []);
});

test("desktop navigation reserves More only when actual overflow exists", () => {
  const result = fitWorkorderSections(sections, {
    availableWidth: 500,
    sectionWidths,
    moreWidth: 75,
  });
  assert.deepEqual(result.primarySections.map(({ id }) => id), ["concern", "chat", "parts", "assignment", "completion"]);
  assert.deepEqual(result.overflowSections.map(({ id }) => id), ["diagnosisRepair", "activity"]);
  const usedWidth = result.primarySections.reduce((total, section) => total + sectionWidths[section.id], 75);
  assert.ok(usedWidth <= 500);
});

test("desktop navigation treats explicit overflow as lower priority instead of forced overflow", () => {
  const wide = fitWorkorderSections(sections, {
    availableWidth: 800,
    sectionWidths,
    moreWidth: 75,
  });
  assert.ok(wide.primarySections.some(({ id }) => id === "activity"));

  const narrow = fitWorkorderSections(sections, {
    availableWidth: 390,
    sectionWidths,
    moreWidth: 75,
  });
  assert.ok(narrow.overflowSections.some(({ id }) => id === "activity"));
  assert.ok(narrow.primarySections.some(({ id }) => id === "assignment"));
  assert.ok(narrow.primarySections.some(({ id }) => id === "completion"));
});
