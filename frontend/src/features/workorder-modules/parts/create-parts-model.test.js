import assert from "node:assert/strict";
import test from "node:test";
import {
  createPartHasContent,
  createPartRequiresSerializedUnits,
  createPartRenderIndexes,
  filledCreatePartIndexes,
  firstBlankCreatePartIndex,
  invalidCreatePartIndex,
  serializedSelectionMatchesQuantity,
  serializedSelectionPatch,
} from "./create-parts-model.js";

const blank = () => ({ partNo: "", qty: "", uomCode: "pc", repairOrder: "" });

test("create Parts presentation hides untouched placeholder rows", () => {
  const parts = [blank(), blank(), blank()];

  assert.deepEqual(filledCreatePartIndexes(parts), []);
  assert.equal(firstBlankCreatePartIndex(parts), 0);
  assert.deepEqual(createPartRenderIndexes(parts), []);
});

test("one active blank editor is visible without exposing the other placeholders", () => {
  const parts = [blank(), blank(), blank()];

  assert.deepEqual(createPartRenderIndexes(parts, 1), [1]);
});

test("filled summaries retain source indexes and include the active blank editor", () => {
  const parts = [
    { partNo: "FILTER", qty: "1", uomCode: "pc", repairOrder: "Replace" },
    blank(),
    { partNo: "COOLANT", qty: "2", uomCode: "gal", repairOrder: "Refill" },
  ];

  assert.deepEqual(filledCreatePartIndexes(parts), [0, 2]);
  assert.deepEqual(createPartRenderIndexes(parts, 1), [0, 1, 2]);
});

test("repair-only and quantity-only rows count as entered work", () => {
  assert.equal(createPartHasContent({ repairOrder: "Inspect mount" }), true);
  assert.equal(createPartHasContent({ qty: "2" }), true);
  assert.equal(createPartHasContent(blank()), false);
});

test("validation locates the exact first entered row with invalid quantity", () => {
  const parts = [
    blank(),
    { partNo: "OIL", qty: "2.5", uomCode: "gal", repairOrder: "Refill" },
    { partNo: "FILTER", qty: "", uomCode: "pc", repairOrder: "Replace" },
  ];

  assert.equal(invalidCreatePartIndex(parts), 2);
});

test("unsupported units remain invalid while blank rows remain valid", () => {
  assert.equal(invalidCreatePartIndex([blank()]), -1);
  assert.equal(invalidCreatePartIndex([{ partNo: "FILTER", qty: "1", uomCode: "mystery" }]), 0);
});

test("catalog count parts require one exact serialized unit per quantity", () => {
  const tire = {
    catalogPartId: "part-1",
    partNo: "Tire",
    qty: "4",
    uomCode: "ea",
    serializationRequired: true,
    serializedUnitIds: ["unit-1", "unit-2", "unit-3"],
  };
  assert.equal(createPartRequiresSerializedUnits(tire), true);
  assert.equal(serializedSelectionMatchesQuantity(tire), false);
  assert.equal(invalidCreatePartIndex([tire]), 0);
  assert.equal(serializedSelectionMatchesQuantity({
    ...tire,
    serializedUnitIds: ["unit-1", "unit-2", "unit-3", "unit-4"],
  }), true);
});

test("manual count rows and measured catalog rows keep existing create behavior", () => {
  assert.equal(createPartRequiresSerializedUnits({ partNo: "Shop supply", qty: "1", uomCode: "ea" }), false);
  assert.equal(createPartRequiresSerializedUnits({ catalogPartId: "part-1", partNo: "Bulk fastener", qty: "4", uomCode: "ea" }), false);
  assert.equal(createPartRequiresSerializedUnits({ catalogPartId: "part-1", partNo: "Oil", qty: "2.5", uomCode: "gal" }), false);
});

test("serialized child selection is the only quantity source", () => {
  const units = [
    { id: "unit-1", serialNumber: "SER-1" },
    { id: "unit-2", serialNumber: "SER-2" },
    { id: "unit-3", serialNumber: "SER-3" },
  ];
  assert.deepEqual(serializedSelectionPatch(units, new Set(["unit-1", "unit-3"])), {
    qty: "2",
    serializedUnitIds: ["unit-1", "unit-3"],
    serializedSerialNumbers: ["SER-1", "SER-3"],
  });
  assert.deepEqual(serializedSelectionPatch(units, new Set()), {
    qty: "",
    serializedUnitIds: [],
    serializedSerialNumbers: [],
  });
});
