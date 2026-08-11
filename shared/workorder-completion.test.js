import assert from "node:assert/strict";
import test from "node:test";
import { repairOrderCompletionText, resolveWorkPerformed } from "./workorder-completion.js";

test("explicit repair-completed text remains authoritative", () => {
  assert.equal(resolveWorkPerformed({
    workPerformed: " Repaired air line. ",
    parts: [{ repairOrder: "Replace fitting" }],
  }), "Repaired air line.");
});

test("part repair orders become completion text without duplicate mechanic entry", () => {
  const parts = [
    { partNo: "46305", repairOrder: "Put new hub seal, adjust brakes" },
    { partNo: "OIL", repairOrder: "Change engine oil" },
    { partNo: "46305-C24", repairOrder: " put new hub seal, adjust brakes " },
  ];

  assert.equal(repairOrderCompletionText(parts), "Put new hub seal, adjust brakes\nChange engine oil");
  assert.equal(resolveWorkPerformed({ workPerformed: "", parts }), "Put new hub seal, adjust brakes\nChange engine oil");
});

test("completion text stays empty when neither repair source exists", () => {
  assert.equal(resolveWorkPerformed({ workPerformed: "", parts: [{ partNo: "FILTER", repairOrder: "" }] }), "");
});
