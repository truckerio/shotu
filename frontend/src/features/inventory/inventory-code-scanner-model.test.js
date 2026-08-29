import assert from "node:assert/strict";
import test from "node:test";
import {
  inventoryScannerAvailable,
  inventoryUsageActions,
  inventoryUsageStatusLabel,
  enqueuePendingCandidate,
  mergeUsageSnapshot,
  normalizeInventoryCode,
  removePendingCandidate,
  replaceUsage,
  shouldApplyUsageSnapshot,
} from "./inventory-code-scanner-model.js";

test("scanner model normalizes manual input and requires camera capture without native barcode detection", () => {
  assert.equal(normalizeInventoryCode("  label-code  "), "label-code");
  assert.equal(inventoryScannerAvailable({ navigator: { mediaDevices: { getUserMedia() {} } } }), true);
  assert.equal(inventoryScannerAvailable({ BarcodeDetector: class {}, navigator: {} }), false);
});

test("pending scanner candidates preserve each resolved unit and deduplicate by unit id", () => {
  const first = { unit: { id: "unit-1" }, issueKey: "issue-1" };
  const second = { unit: { id: "unit-2" }, issueKey: "issue-2" };
  const initial = enqueuePendingCandidate([], first);
  assert.deepEqual(initial, { candidates: [first], selectedId: "unit-1", added: true });
  const appended = enqueuePendingCandidate(initial.candidates, second);
  assert.deepEqual(appended, { candidates: [first, second], selectedId: "unit-2", added: true });
  const duplicate = enqueuePendingCandidate(appended.candidates, { ...first, issueKey: "different-key" });
  assert.deepEqual(duplicate, { candidates: [first, second], selectedId: "unit-1", added: false });
  assert.deepEqual(removePendingCandidate(appended.candidates, "unit-2"), [first]);
});

test("usage model replaces stable refresh rows without duplication", () => {
  const first = { id: "usage-1", status: "issued" };
  assert.deepEqual(replaceUsage([first], { ...first, status: "installed" }), [{ id: "usage-1", status: "installed" }]);
  assert.deepEqual(replaceUsage([], first), [first]);
  assert.equal(inventoryUsageStatusLabel("reserved"), "Reserved — awaiting Office approval");
  assert.equal(inventoryUsageStatusLabel("installed_pending_approval"), "Installed — awaiting Office approval");
  assert.equal(inventoryUsageStatusLabel("returned"), "Returned unused");
});

test("usage actions preserve server authority while supporting legacy reserved records", () => {
  assert.deepEqual(inventoryUsageActions({ status: "reserved" }), {
    install: true,
    returnUnused: true,
    remove: false,
  });
  assert.deepEqual(inventoryUsageActions({ status: "installed_pending_approval" }), {
    install: false,
    returnUnused: false,
    remove: true,
  });
  assert.deepEqual(inventoryUsageActions({ status: "installed" }), {
    install: false,
    returnUnused: false,
    remove: true,
  });
  assert.deepEqual(inventoryUsageActions({
    status: "consumed",
    allowedActions: { install: false, returnUnused: false, remove: true },
  }), {
    install: false,
    returnUnused: false,
    remove: true,
  });
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
