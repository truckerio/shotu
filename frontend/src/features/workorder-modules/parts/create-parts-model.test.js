import assert from "node:assert/strict";
import test from "node:test";
import {
  createPartHasContent,
  createPartRequiresSerializedUnits,
  createPartRenderIndexes,
  filledCreatePartIndexes,
  firstBlankCreatePartIndex,
  invalidCreatePartIndex,
  independentSerializedPartRows,
  replacePartWithSerializedUnitRows,
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

test("serialized selections become one quantity-one row per exact unit", () => {
  const source = {
    catalogPartId: "part-1",
    partNo: "Tire",
    qty: "3",
    uomCode: "ea",
    repairOrder: "Replace tire",
    serializationRequired: true,
    serializedUnitIds: ["unit-1", "unit-2", "unit-3"],
    serializedSerialNumbers: ["SER-1", "SER-2", "SER-3"],
  };

  const rows = independentSerializedPartRows([source, blank(), blank()]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.filter(createPartHasContent).map((row) => [row.qty, row.serializedUnitIds, row.serializedSerialNumbers]), [
    ["1", ["unit-1"], ["SER-1"]],
    ["1", ["unit-2"], ["SER-2"]],
    ["1", ["unit-3"], ["SER-3"]],
  ]);
  assert.ok(rows.filter(createPartHasContent).every((row) => row.partNo === "Tire" && row.repairOrder === "Replace tire"));
});

test("serialized row replacement preserves other work and rejects duplicate unit identity", () => {
  const parts = [
    { catalogPartId: "part-1", partNo: "Tire", qty: "1", uomCode: "ea", repairOrder: "Replace", serializationRequired: true, serializedUnitIds: ["unit-1"], serializedSerialNumbers: ["SER-1"] },
    { partNo: "Oil", qty: "2", uomCode: "gal", repairOrder: "Refill" },
    blank(),
  ];
  const next = replacePartWithSerializedUnitRows(parts, 0, {
    serializedUnitIds: ["unit-1", "unit-2", "unit-2"],
    serializedSerialNumbers: ["SER-1", "SER-2", "SER-2 duplicate"],
  });

  assert.deepEqual(next.slice(0, 2).map((row) => row.serializedUnitIds), [["unit-1"], ["unit-2"]]);
  assert.deepEqual(next[2], parts[1]);
  assert.equal(next.length, 3);
});

test("serialized row replacement fails closed instead of partially dropping an over-capacity selection", () => {
  const serialized = { catalogPartId: "part-1", partNo: "Tire", qty: "1", uomCode: "ea", serializationRequired: true, serializedUnitIds: ["unit-1"] };
  const parts = [serialized, ...Array.from({ length: 17 }, (_, index) => ({ partNo: `PART-${index}`, qty: "1", uomCode: "ea" }))];

  assert.equal(replacePartWithSerializedUnitRows(parts, 0, {
    serializedUnitIds: ["unit-1", "unit-2"],
    serializedSerialNumbers: ["SER-1", "SER-2"],
  }), parts);
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
