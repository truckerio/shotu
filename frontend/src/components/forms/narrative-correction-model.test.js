import assert from "node:assert/strict";
import test from "node:test";
import {
  canAutoReplaceNarrativeIssue,
  issueOccurrenceKey,
  normalizeNarrativeIssues,
} from "./narrative-correction-model.js";

test("issues require matching text revisions, supported categories, and non-overlapping ranges", () => {
  const text = "brke makes noise";
  const issues = normalizeNarrativeIssues({ issues: [
    { start: 0, end: 4, kind: "spelling", problem: "stale", suggestions: ["brake"] },
    { start: 0, end: 4, kind: "style", problem: "brke", suggestions: ["brake"] },
    { start: 0, end: 4, kind: "spelling", problem: "brke", suggestions: ["brake", "brake"] },
    { start: 2, end: 8, kind: "grammar", problem: "ke mak", suggestions: ["brake makes"] },
    { start: 5, end: 10, kind: "context", problem: "makes", suggestions: ["made"] },
  ] }, text);

  assert.deepEqual(issues.map(({ kind, problem, suggestions }) => ({ kind, problem, suggestions })), [
    { kind: "spelling", problem: "brke", suggestions: ["brake"] },
    { kind: "context", problem: "makes", suggestions: ["made"] },
  ]);
});

test("delimiter auto-replacement accepts only one high-confidence lowercase spelling suggestion", () => {
  const base = {
    autoReplace: true,
    end: 4,
    kind: "spelling",
    problem: "brke",
    start: 0,
    suggestions: ["brake"],
  };
  assert.equal(canAutoReplaceNarrativeIssue({
    issue: base,
    text: "brke ",
    selectionStart: 5,
    selectionEnd: 5,
  }), true);
  assert.equal(canAutoReplaceNarrativeIssue({
    issue: { ...base, autoReplace: false, confidence: 95 },
    text: "brke ",
    selectionStart: 5,
    selectionEnd: 5,
  }), true);
  assert.equal(canAutoReplaceNarrativeIssue({
    issue: { ...base, autoReplace: false, confidence: 80 },
    text: "brke ",
    selectionStart: 5,
    selectionEnd: 5,
  }), false);
  for (const issue of [
    { ...base, autoReplace: false },
    { ...base, kind: "grammar" },
    { ...base, problem: "BRKE" },
    { ...base, problem: "brk3" },
    { ...base, suggestions: ["brake", "broke"] },
  ]) {
    assert.equal(canAutoReplaceNarrativeIssue({
      issue,
      text: `${issue.problem} `,
      selectionStart: issue.end + 1,
      selectionEnd: issue.end + 1,
    }), false);
  }
  assert.equal(canAutoReplaceNarrativeIssue({
    issue: base,
    text: "brke ",
    selectionStart: 5,
    selectionEnd: 5,
    isComposing: true,
  }), false);
});

test("ignore-once keys distinguish category and occurrence", () => {
  assert.notEqual(
    issueOccurrenceKey({ kind: "spelling", start: 0, end: 4, problem: "brke" }),
    issueOccurrenceKey({ kind: "spelling", start: 5, end: 9, problem: "brke" }),
  );
});
