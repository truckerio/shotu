import assert from "node:assert/strict";
import test from "node:test";
import { createCheckpointScrollWork, firstVisibleCheckpointRow, checkpointPrefetchDistance } from "./checkpoint-scroll-work.js";

function harness() {
  let id = 0;
  const frames = new Map();
  const timers = new Map();
  const reads = [];
  const writes = [];
  const work = createCheckpointScrollWork({
    onFrame: (hint) => reads.push(hint), onPersist: (value) => writes.push(value),
    requestFrame: (fn) => { frames.set(++id, fn); return id; }, cancelFrame: (key) => frames.delete(key),
    setTimer: (fn) => { timers.set(++id, fn); return id; }, clearTimer: (key) => timers.delete(key),
  });
  function tick(jobs) { const pending = [...jobs.values()]; jobs.clear(); pending.forEach((fn) => fn()); }
  return { work, frames, timers, reads, writes, frame: () => tick(frames), settle: () => tick(timers) };
}

test("rapid wheel/scroll bursts produce one read pass per frame, with latest direction", () => {
  const h = harness();
  for (let index = 0; index < 120; index++) h.work.schedule(index === 119 ? -1 : 0);
  assert.equal(h.frames.size, 1);
  assert.deepEqual(h.reads, []);
  h.frame();
  assert.deepEqual(h.reads, [-1]);
  h.work.schedule(); h.frame();
  assert.deepEqual(h.reads, [-1, 0]);
});

test("position persistence is trailing-only and flushes the newest scoped snapshot", () => {
  const h = harness();
  for (let offset = 0; offset < 120; offset++) h.work.persist({ key: "old-query", position: { page: 3, offset } });
  assert.equal(h.timers.size, 1);
  assert.deepEqual(h.writes, []);
  h.settle();
  assert.deepEqual(h.writes, [{ key: "old-query", position: { page: 3, offset: 119 } }]);
  h.work.persist({ key: "new-query", position: { page: 1 } });
  h.work.flush();
  assert.equal(h.writes.length, 2);
  assert.equal(h.timers.size, 0);
});

test("navigation flush reads pending scroll before saving; cleanup cancels detached DOM reads", () => {
  const h = harness();
  h.work.schedule(-1); h.work.persist({ key: "q", position: { page: 7 } });
  h.work.flush();
  assert.deepEqual(h.reads, [-1]);
  assert.equal(h.frames.size, 0);
  h.work.schedule(); h.work.persist({ key: "q", position: { page: 8 } });
  h.work.dispose();
  h.frame(); h.settle();
  assert.deepEqual(h.reads, [-1]);
  assert.equal(h.writes.at(-1).position.page, 8);
});

test("visible row search uses at most seven layout reads for the 100-row window", () => {
  let reads = 0;
  const rows = Array.from({ length: 100 }, (_, index) => ({ index, getBoundingClientRect() { reads++; return { bottom: (index + 1) * 80 }; } }));
  assert.equal(firstVisibleCheckpointRow(rows, 7900).index, 98);
  assert.ok(reads <= 7, `layout reads: ${reads}`);
  assert.equal(firstVisibleCheckpointRow(rows, 8000), null);
  assert.equal(firstVisibleCheckpointRow([], 0), null);
  assert.equal(firstVisibleCheckpointRow(rows, -100).index, 0);
});

test("prefetch keeps at least 1200px runway and scales with the usable viewport", () => {
  assert.equal(checkpointPrefetchDistance({ top: 200, bottom: 600 }), 1200);
  assert.equal(checkpointPrefetchDistance({ top: 100, bottom: 1100 }), 2000);
});
