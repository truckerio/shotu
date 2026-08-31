import assert from "node:assert/strict";
import test from "node:test";

import { createUsedPartsAutosave } from "./used-parts-autosave.js";

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function harness() {
  const timers = new Map();
  const saves = [];
  const saved = [];
  const stored = [];
  let nextTimer = 1;
  const controller = createUsedPartsAutosave({
    setTimer(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimer(id) { timers.delete(id); },
    save(rows, revision) {
      const request = deferred();
      saves.push({ request, revision, rows });
      return request.promise;
    },
    onSaved(rows, revision, result) { saved.push({ result, revision, rows }); },
    onStoreDraft(rows, revision) { stored.push({ revision, rows }); },
  });
  function fireTimer() {
    const [id, callback] = timers.entries().next().value;
    timers.delete(id);
    callback();
  }
  return { controller, fireTimer, saved, saves, stored, timers };
}

test("serializes saves and immediately coalesces an edit made during a delayed request", async () => {
  const { controller, fireTimer, saves, stored } = harness();
  controller.reset([]);
  controller.update([{ partNo: "old" }]);
  fireTimer();
  assert.equal(saves.length, 1);

  controller.update([{ partNo: "new value " }]);
  assert.deepEqual(stored.at(-1).rows, [{ partNo: "new value " }]);
  saves[0].request.resolve();
  await Promise.resolve();
  assert.equal(saves.length, 2);
  assert.deepEqual(saves[1].rows, [{ partNo: "new value " }]);
  saves[1].request.resolve();
  assert.equal(await controller.flush(), true);
  assert.equal(controller.hasPending(), false);
});

test("failed latest save retains its draft and retries the same latest revision", async () => {
  const { controller, fireTimer, saves, stored } = harness();
  controller.reset([]);
  controller.update([{ partNo: "kept " }]);
  fireTimer();
  saves[0].request.reject(new Error("offline"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(controller.hasPending(), true);
  assert.deepEqual(stored.at(-1).rows, [{ partNo: "kept " }]);

  const flushing = controller.flush();
  assert.equal(saves.length, 2);
  assert.deepEqual(saves[1].rows, [{ partNo: "kept " }]);
  saves[1].request.resolve();
  assert.equal(await flushing, true);
  assert.equal(controller.hasPending(), false);
});

test("reset prevents a prior workorder response from acknowledging the current draft", async () => {
  const { controller, fireTimer, saved, saves } = harness();
  controller.reset([]);
  controller.update([{ partNo: "old-workorder" }]);
  fireTimer();
  controller.reset([]);
  controller.update([{ partNo: "new-workorder" }]);
  fireTimer();
  saves[0].request.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(saves.length, 2);
  assert.equal(saved.length, 0);
  saves[1].request.resolve();
  assert.equal(await controller.flush(), true);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].rows, [{ partNo: "new-workorder" }]);
  assert.equal(controller.hasPending(), false);
});

test("latest server normalization does not replace or reschedule the active raw draft", async () => {
  const { controller, fireTimer, saved, saves, timers } = harness();
  controller.reset([]);
  controller.update([{ partNo: " FILTER ", qty: "1" }]);
  fireTimer();
  saves[0].request.resolve({ parts: [{ partNo: "FILTER", qty: "1" }] });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(saved[0].rows, [{ partNo: " FILTER ", qty: "1" }]);
  assert.deepEqual(saved[0].result, { parts: [{ partNo: "FILTER", qty: "1" }] });
  controller.update([{ partNo: " FILTER ", qty: "1" }]);
  assert.equal(timers.size, 0);
  assert.equal(controller.hasPending(), false);
});
