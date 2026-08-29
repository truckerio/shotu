import assert from "node:assert/strict";
import test from "node:test";
import {
  inventoryScannerAvailable,
  inventoryUsageStatusLabel,
  mergeUsageSnapshot,
  normalizeInventoryCode,
  replaceUsage,
  shouldApplyUsageSnapshot,
} from "./inventory-code-scanner-model.js";

test("scanner model normalizes manual input and requires both camera capabilities", () => {
  assert.equal(normalizeInventoryCode("  label-code  "), "label-code");
  assert.equal(inventoryScannerAvailable({ BarcodeDetector: class {}, navigator: { mediaDevices: { getUserMedia() {} } } }), true);
  assert.equal(inventoryScannerAvailable({ BarcodeDetector: class {}, navigator: {} }), false);
});

test("usage model replaces stable refresh rows without duplication", () => {
  const first = { id: "usage-1", status: "issued" };
  assert.deepEqual(replaceUsage([first], { ...first, status: "installed" }), [{ id: "usage-1", status: "installed" }]);
  assert.deepEqual(replaceUsage([], first), [first]);
  assert.equal(inventoryUsageStatusLabel("returned"), "Returned unused");
});

test("usage snapshots cannot overwrite a newer issue or finalization", () => {
  assert.equal(shouldApplyUsageSnapshot({
    requestGeneration: 2,
    currentGeneration: 2,
    requestRevision: 4,
    currentRevision: 4,
  }), true);
  assert.equal(shouldApplyUsageSnapshot({
    requestGeneration: 2,
    currentGeneration: 2,
    requestRevision: 4,
    currentRevision: 5,
  }), false);
  assert.equal(shouldApplyUsageSnapshot({
    requestGeneration: 1,
    currentGeneration: 2,
    requestRevision: 4,
    currentRevision: 4,
  }), false);
});

test("stale usage snapshots add older history without replacing newer local state", () => {
  const current = [
    { id: "new", status: "issued" },
    { id: "same", status: "installed" },
  ];
  const stale = [
    { id: "same", status: "issued" },
    { id: "older", status: "returned" },
  ];
  assert.deepEqual(mergeUsageSnapshot(current, stale), [
    { id: "new", status: "issued" },
    { id: "same", status: "installed" },
    { id: "older", status: "returned" },
  ]);
  assert.equal(mergeUsageSnapshot([], Array.from({ length: 120 }, (_, index) => ({ id: String(index) }))).length, 100);
});
