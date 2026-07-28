import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("./SurveillanceWorkspace.jsx", import.meta.url), "utf8");

test("surveillance uses the shared mobile queue toolbar", () => {
  assert.match(workspace, /import \{ MobileQueueToolbar \}/);
  assert.match(workspace, /<MobileQueueToolbar[\s\S]*className="surveillance-compact-queues"/);
  assert.doesNotMatch(workspace, /surveillance-queue-primary-row/);
});
