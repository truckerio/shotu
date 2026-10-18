import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  editableMechanicProgress,
  shouldSyncMechanicProgressFromServer,
  mechanicProgressRequest,
  normalizedMechanicProgress,
} from "./useMechanicProgress.js";

test("manual save request sends cleared Diagnosis and Repair completed values", async () => {
  const sent = [];
  const saveProgress = async (payload) => {
    sent.push(payload);
    return { progress: { ...payload, version: payload.expectedVersion + 1 } };
  };
  const renderedValue = normalizedMechanicProgress({
    diagnosis: "",
    workPerformed: "",
    laborHours: "",
  });

  await saveProgress(mechanicProgressRequest({
    workorderId: "workorder-71",
    expectedVersion: 8,
    value: renderedValue,
    recordActivity: true,
  }));

  assert.deepEqual(sent, [{
    workorderId: "workorder-71",
    expectedVersion: 8,
    diagnosis: "",
    workPerformed: "",
    laborHours: "",
    recordActivity: true,
  }]);
});

test("hook updates its save ref during same-workorder render before click handlers can flush", () => {
  const source = readFileSync(new URL("./useMechanicProgress.js", import.meta.url), "utf8");
  const renderSync = source.indexOf("valueRef.current = renderedValue;");
  const persistCallback = source.indexOf("const persist = useCallback");

  assert.ok(renderSync > 0);
  assert.ok(persistCallback > renderSync);
  assert.doesNotMatch(
    source,
    /useEffect\(\(\) => \{\s*valueRef\.current = normalizedMechanicProgress\(value\)/,
  );
});

test("concern-only progress excludes protected repair fields and retains an explicit empty concern", () => {
  const value = editableMechanicProgress({ concern: "", diagnosis: "private", workPerformed: "private", laborHours: "4" }, { canSaveNotes: false, canSaveConcern: true });
  assert.deepEqual(value, { concern: "" });
  assert.deepEqual(mechanicProgressRequest({ workorderId: "wo1", expectedVersion: 3, value, recordActivity: true }), {
    workorderId: "wo1", expectedVersion: 3, concern: "", recordActivity: true,
  });
});

test("notes-only progress never sends the read-only concern snapshot", () => {
  const value = editableMechanicProgress({ concern: "Office changed this", diagnosis: "Found leak" }, { canSaveNotes: true, canSaveConcern: false });
  assert.equal(Object.hasOwn(value, "concern"), false);
  assert.equal(Object.hasOwn(mechanicProgressRequest({ value }), "concern"), false);
});

test("clean same-workorder refresh accepts office concern baseline without autosaving it", () => {
  const remote = { concern: "Office revised request", diagnosis: "", workPerformed: "", laborHours: "" };
  const input = { wasDirty: false, inFlight: false, localVersion: 3, serverVersion: 4, renderedValue: remote, savedValue: remote };
  assert.equal(shouldSyncMechanicProgressFromServer(input), true);
  assert.equal(shouldSyncMechanicProgressFromServer({ ...input, wasDirty: true }), false);
  assert.equal(shouldSyncMechanicProgressFromServer({ ...input, inFlight: true }), false);
  assert.equal(shouldSyncMechanicProgressFromServer({ ...input, renderedValue: { ...remote, concern: "Mechanic local edit" } }), false);
  assert.equal(shouldSyncMechanicProgressFromServer({ ...input, serverVersion: 2 }), false);
});
