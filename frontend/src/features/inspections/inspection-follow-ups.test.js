import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { openInspectionFollowUps } from "./inspection-api-model.js";

const detail = readFileSync(new URL("./InspectionDetail.jsx", import.meta.url), "utf8");
const experience = readFileSync(new URL("./InspectionExperience.jsx", import.meta.url), "utf8");

test("completed follow-up projection keeps only open and reopened findings with their concise note", () => {
  assert.deepEqual(openInspectionFollowUps({
    findings: [
      { id: "finding-1", note: "Left marker lamp out" },
      { id: "finding-2", note: "Loose mudflap" },
    ],
    followUps: [
      { id: "follow-1", findingId: "finding-1", status: "open", version: 3 },
      { id: "follow-2", findingId: "finding-2", status: "reopened", version: 5 },
      { id: "follow-3", findingId: "finding-1", status: "resolved_workorder", version: 4 },
    ],
  }), [
    { id: "follow-1", findingId: "finding-1", note: "Left marker lamp out", status: "open", version: 3 },
    { id: "follow-2", findingId: "finding-2", note: "Loose mudflap", status: "reopened", version: 5 },
  ]);
});

test("follow-up controls are completed-only, versioned, and absent from read-only projections", () => {
  assert.match(detail, /inspection\.status === "completed" && openFollowUps\.length/);
  assert.match(detail, /canResolveFollowUps/);
  assert.match(detail, /Create workorder/);
  assert.match(detail, /Link existing workorder/);
  assert.match(detail, /No workorder needed/);
  assert.match(detail, /minLength="2"/);
  assert.match(experience, /follow-ups\/\$\{encodeURIComponent\(findingId\)\}\/actions\/\$\{action\}/);
  assert.match(experience, /expectedVersion: followUp\.version/);
  assert.match(experience, /idempotencyKey/);
  assert.match(experience, /await reloadActive\(\)/);
});
