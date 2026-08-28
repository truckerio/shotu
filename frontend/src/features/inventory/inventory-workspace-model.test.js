import assert from "node:assert/strict";
import test from "node:test";
import { filterAndSortStock, stockFilterCounts, stockState, stockStateLabel } from "./inventory-workspace-model.js";

const stock = [
  { partNumber: "P-10", quantityOnHand: 10, quantityReserved: 3, quantityAvailable: 7, locationCount: 2, locations: [{}, {}, {}] },
  { partNumber: "P-2", quantityOnHand: 4, quantityReserved: 4, quantityAvailable: 0, locationCount: 1, locations: [{}, {}, {}] },
  { partNumber: "P-30", quantityOnHand: 0, quantityReserved: 0, quantityAvailable: 0, locationCount: 0, locations: [{}, {}, {}] },
  { partNumber: "P-4", quantityOnHand: 12, quantityReserved: 1, quantityAvailable: 11, locationCount: 1, locations: [{}, {}, {}] },
];

test("stock state uses returned quantity truth and exposes non-color labels", () => {
  assert.equal(stockState(stock[0]), "available");
  assert.equal(stockState(stock[1]), "reserved");
  assert.equal(stockState(stock[2]), "out");
  assert.equal(stockStateLabel("reserved"), "Fully reserved");
  assert.deepEqual(stockFilterCounts(stock), { all: 4, available: 2, reserved: 1, out: 1 });
});

test("stock tools filter and sort a bounded projection without mutating source order", () => {
  assert.deepEqual(filterAndSortStock(stock).map((item) => item.partNumber), ["P-4", "P-10", "P-2", "P-30"]);
  assert.deepEqual(filterAndSortStock(stock, { filter: "available", sort: "part_asc" }).map((item) => item.partNumber), ["P-4", "P-10"]);
  assert.deepEqual(filterAndSortStock(stock, { sort: "reserved_desc" }).map((item) => item.partNumber), ["P-2", "P-10", "P-4", "P-30"]);
  assert.deepEqual(filterAndSortStock(stock, { sort: "locations_desc" }).map((item) => item.partNumber), ["P-10", "P-4", "P-2", "P-30"]);
  assert.deepEqual(stock.map((item) => item.partNumber), ["P-10", "P-2", "P-30", "P-4"]);
});
