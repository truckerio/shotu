import assert from "node:assert/strict";
import test from "node:test";

import { createSerializedRepairAutosave } from "./serialized-repair-autosave.js";
import { readFileSync } from "node:fs";

const editor = readFileSync(new URL("./UsedPartsEditor.jsx", import.meta.url), "utf8");
const scanner = readFileSync(new URL("./part-requests/SerializedPartsScanner.jsx", import.meta.url), "utf8");

function harness({ fail = false } = {}) {
  const timers = new Map();
  const calls = [];
  const errors = [];
  let nextTimer = 1;
  const controller = createSerializedRepairAutosave({
    setTimer(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimer(id) { timers.delete(id); },
    save: async (part, repairOrder) => {
      calls.push([part.usageId, repairOrder]);
      if (fail) throw new Error("save failed");
    },
    onError: (error) => errors.push(error.message),
  });
  return { calls, controller, errors, timers };
}

test("flush persists the latest repair wording before its debounce fires", async () => {
  const { calls, controller, timers } = harness();
  const part = { usageId: "usage-1" };
  controller.update(part, "Install sensor");
  controller.update(part, "Install sensor and test");

  assert.equal(timers.size, 1);
  assert.equal(await controller.flushAll(), true);
  assert.deepEqual(calls, [["usage-1", "Install sensor and test"]]);
  assert.equal(controller.current("usage-1"), undefined);
});

test("failed flush keeps the latest draft available for retry", async () => {
  const { calls, controller, errors } = harness({ fail: true });
  const part = { usageId: "usage-1" };
  controller.update(part, "Needs retry");

  assert.equal(await controller.flushOne(part), false);
  assert.deepEqual(calls, [["usage-1", "Needs retry"]]);
  assert.deepEqual(errors, ["save failed"]);
  assert.equal(controller.current("usage-1"), "Needs retry");
});

test("blank repair wording remains a persistable draft for completion validation", async () => {
  const { calls, controller } = harness();
  const part = { usageId: "usage-1" };
  controller.update(part, "");

  assert.equal(await controller.flushAll(), true);
  assert.deepEqual(calls, [["usage-1", ""]]);
});

test("successful serialized repair saves update scanner-owned usage state before reloading detail", () => {
  assert.match(editor, /const result = await api\([\s\S]*context\.serializedParts\?\.updateUsage\?\.\(result\.result\?\.usage\);\s*await context\.onChanged\(\);/s);
  assert.match(scanner, /function updateUsage\(usage\)[\s\S]*replaceUsage\(current, usage\)[\s\S]*setUsageSnapshotReady\(true\)/s);
  assert.match(scanner, /recordUsage,\s*updateUsage,/s);
});
