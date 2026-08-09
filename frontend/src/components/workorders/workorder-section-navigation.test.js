import assert from "node:assert/strict";
import test from "node:test";
import { splitWorkorderSections } from "./workorder-section-navigation.js";

test("phone navigation keeps four obvious modules and moves every other module into More", () => {
  const result = splitWorkorderSections([
    { id: "concern" },
    { id: "diagnosisRepair" },
    { id: "chat" },
    { id: "parts" },
    { id: "preview" },
    { id: "completion" },
    { id: "assignment", overflow: true },
  ]);
  assert.deepEqual(result.primarySections.map(({ id }) => id), ["concern", "diagnosisRepair", "chat", "parts"]);
  assert.deepEqual(result.overflowSections.map(({ id }) => id), ["preview", "completion", "assignment"]);
});

test("navigation preserves a short primary set and all explicit overflow modules", () => {
  const result = splitWorkorderSections([
    { id: "work" },
    { id: "chat" },
    { id: "activity", overflow: true },
  ]);
  assert.deepEqual(result.primarySections.map(({ id }) => id), ["work", "chat"]);
  assert.deepEqual(result.overflowSections.map(({ id }) => id), ["activity"]);
});
