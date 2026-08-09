import assert from "node:assert/strict";
import test from "node:test";
import { moduleActionSchema, modulePatchSchema, runtimeModuleRegistry } from "./workorder-module-runtime.registry.js";

test("runtime registry default-denies unknown module mutations and cross-module patch fields", () => {
  assert.equal(modulePatchSchema("activity"), null);
  assert.equal(moduleActionSchema("chat", "delete"), null);
  assert.equal(modulePatchSchema("unit").safeParse({ formData: { mechanicConcern: "no" } }).success, false);
  assert.equal(modulePatchSchema("unit").safeParse({ formData: { unitNo: "T1" } }).success, true);
});

test("runtime registry owns stable route action allowlists", () => {
  const registry = runtimeModuleRegistry();
  assert.deepEqual(registry.actions.assignment, ["accept", "release", "assign", "reassign"]);
  assert.deepEqual(registry.actions.chat, ["send", "attach", "acknowledge"]);
  assert.equal(moduleActionSchema("completion", "markWorkDone").safeParse({ workPerformed: "Fixed" }).success, true);
});

