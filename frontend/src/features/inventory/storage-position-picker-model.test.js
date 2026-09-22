import assert from "node:assert/strict";
import test from "node:test";
import { receiptStoragePositions, storagePositionPickerCopy } from "./storage-position-picker-model.js";

test("receipt storage picker exposes only active pickable storage positions with hierarchy", () => {
  const positions = [
    { id: "root", name: "Warehouse", canStore: false, isPickable: false },
    { id: "shelf", parentId: "root", name: "Shelf A", usage: "storage", canStore: true, isPickable: true },
    { id: "receiving", parentId: "root", name: "Receiving", usage: "receiving", systemKey: "receiving", canStore: true, isPickable: true },
    { id: "unassigned", parentId: "root", name: "Unassigned", usage: "unassigned", systemKey: "unassigned", canStore: true, isPickable: true },
    { id: "archived", parentId: "root", name: "Old shelf", usage: "storage", canStore: true, isPickable: true, isActive: false },
  ];
  assert.deepEqual(receiptStoragePositions(positions), [{ id: "shelf", label: "Warehouse / Shelf A" }]);
  assert.deepEqual(receiptStoragePositions(positions, "transfer_receive"), [
    { id: "receiving", label: "Warehouse / Receiving" },
    { id: "shelf", label: "Warehouse / Shelf A" },
  ]);
});

test("receipt storage picker uses natural numeric location order", () => {
  const positions = [
    { id: "shop", name: "Shop", code: "SHOP" },
    { id: "a10", parentId: "shop", name: "Aisle 10", code: "A10", usage: "storage", canStore: true, isPickable: true },
    { id: "a2", parentId: "shop", name: "Aisle 2", code: "A2", usage: "storage", canStore: true, isPickable: true },
    { id: "a1", parentId: "shop", name: "Aisle 1", code: "A1", usage: "storage", canStore: true, isPickable: true },
  ];
  assert.deepEqual(receiptStoragePositions(positions).map((entry) => entry.id), ["a1", "a2", "a10"]);
});

test("transfer receipt copy allows Receiving while other exact stock-task destinations stay shelf or bin only", () => {
  assert.deepEqual(storagePositionPickerCopy("transfer_receive"), {
    label: "Put received stock in",
    emptyLabel: "Choose Receiving, shelf, or bin",
    helper: "Use Receiving for stock awaiting put-away, or choose its exact shelf or bin.",
    emptyHelper: "No Receiving area, shelf, or bin is configured for this shop.",
  });
  assert.equal(storagePositionPickerCopy("damage_release").emptyLabel, "Choose shelf or bin");
  assert.equal(storagePositionPickerCopy().emptyLabel, "Receiving area");
});
