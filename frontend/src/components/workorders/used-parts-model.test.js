import assert from "node:assert/strict";
import test from "node:test";
import {
  addUsedPart,
  normalizeUsedParts,
  readonlyUsedParts,
  removeUsedPart,
} from "./used-parts-model.js";

test("zero used parts stay empty until Add part", () => {
  assert.deepEqual(normalizeUsedParts([], 0), []);
  assert.deepEqual(addUsedPart([]), [{ partNo: "", qty: "", repairOrder: "" }]);
});

test("used part rows add and remove without changing serialization fields", () => {
  const rows = addUsedPart([{ partNo: "ABC-123", qty: 2, repairOrder: "Installed" }]);
  assert.equal(rows.length, 2);
  assert.deepEqual(removeUsedPart(rows, 0), []);
});

test("readonly used parts omit blank rows and retain saved values", () => {
  assert.deepEqual(readonlyUsedParts([
    { partNo: "ABC-123", qty: 2, repairOrder: "Installed" },
    { partNo: "", qty: "", repairOrder: "" },
  ]), [{ partNo: "ABC-123", qty: "2", repairOrder: "Installed" }]);
});
