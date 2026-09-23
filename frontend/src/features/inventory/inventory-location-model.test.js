import assert from "node:assert/strict";
import test from "node:test";
import {
  canContainSublocations,
  defaultSublocationType,
  destinationPositions,
  countObservationChanged,
  eligibleSerializedPositionUnits,
  flattenLocationTree,
  visibleLocationTree,
  compactPlacementPath,
  locationPathLabel,
  moveDestinations,
  positionDraftKey,
  positionMoveBody,
  positionStorageDefaults,
  sublocationTypeOptions,
} from "./inventory-location-model.js";

test("compact placement paths omit the selected parent while retaining the physical route", () => {
  const placement = { code: "B3", pathCodes: ["WH", "A1", "S2", "B3"], pathKinds: ["warehouse", "aisle", "shelf", "bin"] };
  assert.equal(compactPlacementPath(placement, true), "A1 › S2 › B3");
  assert.equal(compactPlacementPath(placement, false), "A1 › S2 › B3");
  assert.equal(compactPlacementPath({ code: "B3" }, true), "B3");
  assert.equal(compactPlacementPath({ code: "B3", pathCodes: ["WH", "FAST", "A1", "S1", "B3"], pathKinds: ["warehouse", "area", "aisle", "shelf", "bin"] }, true), "A1 › S1 › B3");
  assert.equal(compactPlacementPath({ code: "A1-B1-S3", pathCodes: ["SHOP", "A1", "A1-B1", "A1-B1-S3"], pathKinds: ["room", "aisle", "bin", "shelf"] }), "A1-B1-S3");
});

const locations = [
  { id: "w", name: "Main", code: "MAIN" },
  { id: "a", name: "Aisle A", parentId: "w" },
  { id: "b", name: "Bin 1", parentId: "a" },
];
test("location model preserves optional hierarchy and full path", () => {
  assert.equal(
    locationPathLabel(locations[2], locations),
    "MAIN · Main / Aisle A / Bin 1",
  );
  assert.deepEqual(
    flattenLocationTree(locations).map(({ location, depth }) => [
      location.id,
      depth,
    ]),
    [
      ["w", 0],
      ["a", 1],
      ["b", 2],
    ],
  );
});
test("location hierarchy keeps warehouses first and uses natural aisle order", () => {
  const arranged = [
    { id: "custom", code: "455", kind: "bin" },
    { id: "a10", code: "A10", kind: "aisle", parentId: "w1" },
    { id: "receiving", code: "SYS-RECEIVING", kind: "area", systemKey: "receiving" },
    { id: "w1", code: "W1", kind: "warehouse" },
    { id: "core", code: "CORE", kind: "area" },
    { id: "a2", code: "A2", kind: "aisle", parentId: "w1" },
  ];
  assert.deepEqual(flattenLocationTree(arranged).map(({ location }) => location.code), ["W1", "A2", "A10", "CORE", "SYS-RECEIVING", "455"]);
  assert.deepEqual(flattenLocationTree(arranged, "w1").map(({ location }) => location.code), ["A2", "A10"]);
  assert.deepEqual(visibleLocationTree(arranged, new Set(["w1"])).map(({ location }) => location.code), ["W1", "A2", "A10", "CORE", "SYS-RECEIVING", "455"]);
});
test("sublocation guidance enforces aisle, shelf, then bin", () => {
  assert.deepEqual(
    sublocationTypeOptions("area").map(([value]) => value),
    ["aisle", "area", "zone", "room", "rack", "shelf", "bin"],
  );
  assert.equal(defaultSublocationType("area"), "aisle");
  assert.equal(defaultSublocationType("aisle"), "shelf");
  assert.deepEqual(sublocationTypeOptions("aisle").map(([value]) => value), ["shelf", "rack"]);
  assert.equal(defaultSublocationType("rack"), "shelf");
  assert.equal(defaultSublocationType("shelf"), "bin");
  assert.deepEqual(sublocationTypeOptions("shelf").map(([value]) => value), ["bin"]);
  assert.equal(canContainSublocations("bin"), false);
  assert.deepEqual(positionStorageDefaults("bin"), { usage: "storage", canStore: true, isPickable: true });
  assert.deepEqual(positionStorageDefaults("area"), { usage: "", canStore: false, isPickable: false });
});
test("visible location tree expands any depth and keeps ancestor context during search", () => {
  assert.deepEqual(
    visibleLocationTree(locations, new Set(["w", "a"])).map(({ location, depth }) => [location.id, depth]),
    [["w", 0], ["a", 1], ["b", 2]],
  );
  assert.deepEqual(
    visibleLocationTree(locations, new Set(), "Bin 1").map(({ location, isMatch }) => [location.id, isMatch]),
    [["w", false], ["a", false], ["b", true]],
  );
});
test("an unobserved line accepts an explicit zero", () => {
  assert.equal(countObservationChanged(null, "0"), true);
  assert.equal(countObservationChanged(0, "0"), false);
});
test("serialized mover offers only usable exact units at the selected source", () => {
  assert.deepEqual(
    eligibleSerializedPositionUnits(
      [
        {
          id: "eligible",
          positionId: "source",
          status: "in_stock",
          conditionCode: "new",
        },
        {
          id: "other-position",
          positionId: "other",
          status: "in_stock",
          conditionCode: "new",
        },
        {
          id: "issued",
          positionId: "source",
          status: "issued",
          conditionCode: "new",
        },
        {
          id: "repair",
          positionId: "source",
          status: "in_stock",
          conditionCode: "needs_repair",
        },
        {
          id: "legacy",
          positionId: "source",
          status: "in_stock",
          conditionCode: "unknown",
          custodyLegacyAvailable: true,
        },
        {
          id: "unknown",
          positionId: "source",
          status: "in_stock",
          conditionCode: "unknown",
        },
      ],
      "source",
    ).map((unit) => unit.id),
    ["eligible", "legacy"],
  );
});
test("position draft identity is stable across serial ordering", () => {
  assert.equal(
    positionDraftKey({
      partId: "p",
      locationId: "l",
      quantity: "2",
      serialUnitIds: ["b", "a"],
    }),
    positionDraftKey({
      partId: "p",
      locationId: "l",
      quantity: "2",
      serialUnitIds: ["a", "b"],
    }),
  );
});
test("only active storage positions are destinations", () => {
  assert.deepEqual(
    destinationPositions([
      { id: "a", canStore: true },
      { id: "b", canStore: false },
      { id: "c", canStore: true, isActive: false },
    ]).map((entry) => entry.id),
    ["a"],
  );
});
test("a move cannot target its selected source", () => {
  assert.deepEqual(
    moveDestinations(
      [
        { id: "source", canStore: true },
        { id: "destination", canStore: true },
      ],
      "source",
    ).map((position) => position.id),
    ["destination"],
  );
});
test("aggregate retry body keeps the concurrency and idempotency values", () => {
  const source = { id: "source", version: 4 };
  const destination = { id: "destination", version: 9 };
  const first = positionMoveBody({
    source,
    destination,
    quantity: "2",
    idempotencyKey: "retry-key",
  });
  assert.deepEqual(
    first,
    positionMoveBody({
      source,
      destination,
      quantity: "2",
      idempotencyKey: "retry-key",
    }),
  );
  assert.notEqual(
    positionDraftKey({
      partId: "p",
      locationId: "l",
      sourcePositionId: "source",
      destinationPositionId: "destination",
      quantity: "2",
    }),
    positionDraftKey({
      partId: "p",
      locationId: "l",
      sourcePositionId: "source",
      destinationPositionId: "destination",
      quantity: "3",
    }),
  );
});
