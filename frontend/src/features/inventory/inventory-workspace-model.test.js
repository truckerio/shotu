import assert from "node:assert/strict";
import test from "node:test";
import { filterAndSortStock, stockFilterCounts, stockState, stockStateLabel, stockIssueLabel, stockIssuePill } from "./inventory-workspace-model.js";

const stock = [
  { partNumber: "P-10", quantityOnHand: 10, quantityReserved: 3, quantityAvailable: 7, locationCount: 2, lowStock: true, locations: [{}, {}, {}] },
  { partNumber: "P-2", quantityOnHand: 4, quantityReserved: 4, quantityAvailable: 0, locationCount: 1, locations: [{}, {}, {}] },
  { partNumber: "P-30", quantityOnHand: 0, quantityReserved: 0, quantityAvailable: 0, locationCount: 0, lowStock: true, locations: [{}, {}, {}] },
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
  assert.deepEqual(filterAndSortStock(stock, { sort: "low_stock_first" }).map((item) => item.partNumber), ["P-30", "P-10", "P-4", "P-2"]);
  assert.deepEqual(stock.map((item) => item.partNumber), ["P-10", "P-2", "P-30", "P-4"]);
});


test("price issues precede every secondary sort without changing availability filters", () => {
  const rows = [
    { partNumber: "A", quantityOnHand: 200, quantityAvailable: 200, quantityReserved: 20, locationCount: 5, issues: [] },
    { partNumber: "Z", quantityOnHand: 1, quantityAvailable: 1, issues: ["missing_internal_price"] },
    { partNumber: "Y", quantityOnHand: 0, quantityAvailable: 0, issues: ["missing_selling_price"] },
  ];
  for (const sort of ["available_desc", "low_stock_first", "part_asc", "reserved_desc", "locations_desc"]) {
    const sorted = filterAndSortStock(rows, { sort });
    assert.equal(sorted.at(-1).partNumber, "A", sort);
  }
  assert.deepEqual(filterAndSortStock(rows, { filter: "available" }).map((item) => item.partNumber), ["Z", "A"]);
  assert.deepEqual(rows.map((item) => item.partNumber), ["A", "Z", "Y"]);
});

test("price attention names the missing rates and affected shops without exposing amounts", () => {
  assert.equal(stockIssueLabel({ issues: [] }), "");
  assert.equal(stockIssueLabel({ issues: ["missing_internal_price", "missing_selling_price"], locations: [
    { locationName: "Chino", issues: ["missing_internal_price"] },
    { locationName: "Arizona", issues: ["missing_internal_price", "missing_selling_price"] },
  ] }), "Missing internal price: Chino, Arizona; Missing selling price: Arizona");
  assert.equal(stockIssueLabel({ issues: ["missing_selling_price"] }), "Missing selling price");
});


test("stock pills summarize unique issues and retain the full correction context", () => {
  assert.equal(stockIssuePill({ issues: [] }), null);
  assert.equal(stockIssuePill(null), null);
  assert.deepEqual(stockIssuePill({ issues: ["missing_internal_price"] }), {
    label: "Price missing", severity: "warning", additionalCount: 0, description: "Missing internal price",
  });
  const item = { issues: ["missing_internal_price", "missing_selling_price", "missing_selling_price"], locations: [
    { locationName: "Chino", issues: ["missing_selling_price"] },
  ] };
  assert.deepEqual(stockIssuePill(item), {
    label: "Price missing", severity: "warning", additionalCount: 1,
    description: "Missing internal price; Missing selling price: Chino",
  });
  assert.equal(item.issues.length, 3);
});

test("unrecognized stock issues request review while known warnings take priority", () => {
  assert.deepEqual(stockIssuePill({ issues: ["future_issue"] }), {
    label: "Check details", severity: "review", additionalCount: 0, description: "Part needs attention",
  });
  for (const issues of [["future_issue", "missing_selling_price"], ["missing_selling_price", "future_issue"]]) {
    const pill = stockIssuePill({ issues });
    assert.equal(pill.severity, "warning");
    assert.equal(pill.label, "Price missing");
    assert.equal(pill.additionalCount, 1);
  }
});
