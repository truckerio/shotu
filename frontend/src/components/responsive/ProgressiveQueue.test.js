import assert from "node:assert/strict";
import test from "node:test";
import {
  PROGRESSIVE_QUEUE_PAGE_SIZE,
  progressiveQueueResetKey,
  progressiveQueueState,
} from "./ProgressiveQueue.js";

test("phone queues reveal twenty rows at a time", () => {
  assert.deepEqual(progressiveQueueState(55, PROGRESSIVE_QUEUE_PAGE_SIZE, true), {
    visibleCount: 20,
    remainingCount: 35,
    nextCount: 20,
  });
  assert.deepEqual(progressiveQueueState(55, 40, true), {
    visibleCount: 40,
    remainingCount: 15,
    nextCount: 15,
  });
});

test("desktop and tablet queues keep every row visible", () => {
  assert.deepEqual(progressiveQueueState(55, 20, false), {
    visibleCount: 55,
    remainingCount: 0,
    nextCount: 0,
  });
});

test("reset keys change with queue, search, or filter state", () => {
  const current = progressiveQueueResetKey(["active", "brakes", "Sacramento"]);
  assert.equal(current, progressiveQueueResetKey(["active", "brakes", "Sacramento"]));
  assert.notEqual(current, progressiveQueueResetKey(["done", "brakes", "Sacramento"]));
  assert.notEqual(current, progressiveQueueResetKey(["active", "tires", "Sacramento"]));
  assert.notEqual(current, progressiveQueueResetKey(["active", "brakes", "Stockton"]));
});
