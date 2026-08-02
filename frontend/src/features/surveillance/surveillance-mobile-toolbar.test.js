import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const queueView = readFileSync(new URL("./workspace/SurveillanceQueueView.jsx", import.meta.url), "utf8");

test("surveillance uses the shared mobile queue toolbar", () => {
  assert.match(queueView, /import \{ MobileQueueToolbar \}/);
  assert.match(queueView, /<MobileQueueToolbar[\s\S]*className="surveillance-compact-queues"/);
  assert.doesNotMatch(queueView, /surveillance-queue-primary-row/);
});
