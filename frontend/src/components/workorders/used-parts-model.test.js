import assert from "node:assert/strict";
import test from "node:test";
import {
  addUsedPart,
  canEditUsedParts,
  defaultUsedPartQuantity,
  initialUsedPartRows,
  installedSerializedUsedParts,
  normalizeUsedParts,
  readonlyUsedParts,
  removeUsedPart,
  usedPartQuantityAfterPartNumberChange,
  usedPartsAccessState,
  workorderPreviewParts,
} from "./used-parts-model.js";

test("zero used parts stay empty until Add part", () => {
  assert.deepEqual(normalizeUsedParts([], 0), []);
  assert.deepEqual(addUsedPart([]), [{ partNo: "", qty: "", uomCode: "pc", repairOrder: "" }]);
});

test("an editable used-parts surface opens with three blank rows by default", () => {
  const rows = initialUsedPartRows([]);
  assert.deepEqual(rows, [
    { partNo: "", qty: "", uomCode: "pc", repairOrder: "" },
    { partNo: "", qty: "", uomCode: "pc", repairOrder: "" },
    { partNo: "", qty: "", uomCode: "pc", repairOrder: "" },
  ]);
  assert.equal(initialUsedPartRows([{ partNo: "FILTER", qty: "1" }]).length, 3);
  assert.equal(addUsedPart(rows, rows.length).length, 4);
  assert.equal(removeUsedPart(rows, 1, rows.length - 1).length, 2);
});

test("selected used parts default an empty quantity to one", () => {
  assert.equal(defaultUsedPartQuantity(""), "1");
  assert.equal(defaultUsedPartQuantity(null), "1");
  assert.equal(defaultUsedPartQuantity("2.5"), "2.5");
});

test("typed used-part identities default to one without turning blank rows into parts", () => {
  const blank = { partNo: "", qty: "", repairOrder: "" };
  assert.equal(usedPartQuantityAfterPartNumberChange(blank, "FILTER"), "1");
  assert.equal(usedPartQuantityAfterPartNumberChange({ ...blank, qty: "3" }, "FILTER"), "3");
  assert.equal(usedPartQuantityAfterPartNumberChange({ ...blank, qty: "1" }, ""), "");
  assert.equal(usedPartQuantityAfterPartNumberChange({ ...blank, qty: "1", repairOrder: "Installed" }, ""), "1");
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
  ]), [{ partNo: "ABC-123", qty: "2", uomCode: "pc", repairOrder: "Installed" }]);
});

test("Add part access follows server permission for every editing role", () => {
  assert.equal(canEditUsedParts("mechanic", { recordUsedParts: true }), true);
  assert.equal(canEditUsedParts("office", {}), true);
  assert.equal(canEditUsedParts("office", { recordUsedParts: false }), false);
  assert.equal(canEditUsedParts("mechanic", { recordUsedParts: false }), false);
  assert.match(usedPartsAccessState("mechanic", {}).message, /read-only/i);
});

test("saved used parts normalize directly into preview form data", () => {
  const form = { parts: [] };
  const savedParts = normalizeUsedParts([{ partNo: "LF3972", qty: 2, repairOrder: "Oil service" }]);
  const previewForm = { ...form, parts: savedParts };

  assert.deepEqual(previewForm.parts, [
    { partNo: "LF3972", qty: "2", uomCode: "pc", repairOrder: "Oil service" },
  ]);
});

test("used parts preserve valid units and default old rows to piece", () => {
  assert.deepEqual(normalizeUsedParts([
    { partNo: "OIL", qty: "2.5", uomCode: "gal", repairOrder: "Refilled" },
    { partNo: "FILTER", qty: 1, repairOrder: "Replaced" },
  ]), [
    { partNo: "OIL", qty: "2.5", uomCode: "gal", repairOrder: "Refilled" },
    { partNo: "FILTER", qty: "1", uomCode: "pc", repairOrder: "Replaced" },
  ]);
});

test("installed serialized parts become immutable display rows and preview parts", () => {
  const detail = {
    modules: {
      parts: {
        data: {
          installedSerializedParts: [
            { catalogPartId: "part-1", partNumber: "0000000002211", quantity: 2, uomCode: "ea" },
            { catalogPartId: "part-2", partNumber: "", quantity: 1, uomCode: "ea" },
          ],
        },
      },
    },
  };
  const installed = installedSerializedUsedParts(detail);
  assert.deepEqual(installed, [{
    catalogPartId: "part-1",
    partNo: "0000000002211",
    qty: "2",
    uomCode: "ea",
    repairOrder: "Installed",
  }]);
  assert.deepEqual(workorderPreviewParts([
    { partNo: "FILTER", qty: 1, uomCode: "pc", repairOrder: "Changed" },
    { partNo: "", qty: "", repairOrder: "" },
  ], installed), [
    { partNo: "0000000002211", qty: "2", uomCode: "ea", repairOrder: "Installed" },
    { partNo: "FILTER", qty: "1", uomCode: "pc", repairOrder: "Changed" },
  ]);
  assert.deepEqual(detail.modules.parts.data.installedSerializedParts, [
    { catalogPartId: "part-1", partNumber: "0000000002211", quantity: 2, uomCode: "ea" },
    { catalogPartId: "part-2", partNumber: "", quantity: 1, uomCode: "ea" },
  ]);
});

test("refreshed serialized summaries add one immutable row then remove it without duplicating manual parts", () => {
  const manualParts = [
    { partNo: "FUEL", qty: "1", uomCode: "gal", repairOrder: "Refilled" },
    { partNo: "", qty: "", repairOrder: "" },
  ];
  const installedDetail = {
    modules: {
      parts: {
        data: {
          installedSerializedParts: [
            { catalogPartId: "part-1", partNumber: "0000000002211", quantity: 1, uomCode: "ea" },
          ],
        },
      },
    },
  };
  const removedDetail = {
    modules: {
      parts: {
        data: { installedSerializedParts: [] },
      },
    },
  };

  const installedRows = installedSerializedUsedParts(installedDetail);
  assert.deepEqual(installedRows, [{
    catalogPartId: "part-1",
    partNo: "0000000002211",
    qty: "1",
    uomCode: "ea",
    repairOrder: "Installed",
  }]);
  assert.deepEqual(workorderPreviewParts(manualParts, installedRows), [
    { partNo: "0000000002211", qty: "1", uomCode: "ea", repairOrder: "Installed" },
    { partNo: "FUEL", qty: "1", uomCode: "gal", repairOrder: "Refilled" },
  ]);

  const removedRows = installedSerializedUsedParts(removedDetail);
  assert.deepEqual(removedRows, []);
  assert.deepEqual(workorderPreviewParts(manualParts, removedRows), [
    { partNo: "FUEL", qty: "1", uomCode: "gal", repairOrder: "Refilled" },
  ]);
});
