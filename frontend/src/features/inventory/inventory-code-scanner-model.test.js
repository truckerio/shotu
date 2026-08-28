import assert from "node:assert/strict";
import test from "node:test";
import {
  inventoryScannerAvailable,
  inventoryUsageStatusLabel,
  normalizeInventoryCode,
  replaceUsage,
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
