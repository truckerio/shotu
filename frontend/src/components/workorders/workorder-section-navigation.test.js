import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  arrangeWorkorderSections,
  fitWorkorderSections,
  moveOptionalWorkorderSection,
  optionalWorkorderSectionIds,
  splitWorkorderSections,
} from "./workorder-section-navigation.js";

const navigationCss = readFileSync(new URL("./workorder-object-page.css", import.meta.url), "utf8");
const navigationSource = readFileSync(new URL("./WorkorderObjectPage.jsx", import.meta.url), "utf8");

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

test("mechanic task priority keeps four core destinations ahead of Help", () => {
  const mechanicSections = [
    { id: "unit", alwaysPrimary: true, priority: 12 },
    { id: "concern", alwaysPrimary: true, priority: 11 },
    { id: "schedule", alwaysPrimary: true, priority: 10 },
    { id: "parts", alwaysPrimary: true, priority: 9 },
    { id: "chat", overflow: true, priority: 8 },
    { id: "completion", overflow: true, priority: 6 },
  ];
  const phone = splitWorkorderSections(mechanicSections);

  assert.deepEqual(phone.primarySections.map(({ id }) => id), ["unit", "concern", "schedule", "parts"]);
  assert.deepEqual(phone.overflowSections.map(({ id }) => id), ["chat", "completion"]);
});

test("every role uses the same fixed core order while optional sections remain rearrangeable", () => {
  const visible = [
    { id: "chat" },
    { id: "parts" },
    { id: "location" },
    { id: "concern" },
    { id: "unit" },
    { id: "schedule" },
    { id: "preview" },
  ];
  const arranged = arrangeWorkorderSections(visible, ["preview", "chat"]);

  assert.deepEqual(arranged.map(({ id }) => id), ["unit", "concern", "schedule", "parts", "preview", "chat", "location"]);
  assert.deepEqual(arranged.filter(({ alwaysPrimary }) => alwaysPrimary).map(({ id }) => id), ["unit", "concern", "schedule", "parts"]);
  assert.deepEqual(optionalWorkorderSectionIds(arranged), ["preview", "chat", "location"]);
  assert.deepEqual(moveOptionalWorkorderSection(["preview", "chat", "location"], "chat", "earlier"), ["chat", "preview", "location"]);
  assert.deepEqual(moveOptionalWorkorderSection(["preview", "chat", "location"], "preview", "earlier"), ["preview", "chat", "location"]);
});

test("desktop inline and More entry motion respects reduced-motion preference", () => {
  assert.match(navigationCss, /\.workorder-section-nav-desktop > button\s*\{[^}]*animation:\s*workorder-section-enter/s);
  assert.match(navigationCss, /\.workorder-section-more-popover\[data-entering\]\s*\{[^}]*animation:\s*workorder-more-enter/s);
  assert.match(navigationCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none;/);
});

test("optional tab arrangement is accessible, resettable, and safely persisted", () => {
  assert.match(navigationSource, /preferenceKey/);
  assert.match(navigationSource, /window\.localStorage\.setItem/);
  assert.match(navigationSource, /window\.localStorage\.removeItem/);
  assert.match(navigationSource, /aria-label=\{`\$\{t\("detail\.moveEarlier"\)\}/);
  assert.match(navigationSource, /aria-label=\{`\$\{t\("detail\.moveLater"\)\}/);
  assert.match(navigationSource, /<ModalOverlay[\s\S]*isDismissable/);
});
