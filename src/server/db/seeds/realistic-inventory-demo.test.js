import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_PARTS, DEMO_SHOPS, DEMO_STOCK, DEMO_WORKORDERS, validateRealisticInventoryDemo } from "./realistic-inventory-demo.data.js";

test("realistic inventory demo covers the daily inventory lifecycle", () => {
  assert.deepEqual(validateRealisticInventoryDemo(), { shops: 4, positions: 58, parts: 10, stockPlacements: 17, workorders: 5 });
  assert.ok(DEMO_SHOPS.some((shop) => shop.positions.some((position) => position.kind === "area")));
  assert.ok(DEMO_SHOPS.some((shop) => shop.positions.some((position) => position.kind === "aisle")));
  assert.ok(DEMO_SHOPS.some((shop) => shop.positions.some((position) => position.kind === "shelf")));
  assert.ok(DEMO_SHOPS.some((shop) => shop.positions.some((position) => position.kind === "bin" && position.stores)));
  assert.ok(DEMO_SHOPS.every((shop) => new Set(shop.positions.map((position) => position.code)).size === shop.positions.length));
  assert.ok(DEMO_SHOPS.flatMap((shop) => shop.positions).every((position) => position.code.length <= 4));
  assert.ok(DEMO_SHOPS.flatMap((shop) => shop.positions).every((position) => position.name && position.legacyCode));
  const chino = DEMO_SHOPS.find((shop) => shop.key === "chino");
  assert.deepEqual(chino.positions.filter((position) => !position.parent).map((position) => position.code), ["W1", "W2", "W3", "CORE"]);
  const warehouseOneAisles = chino.positions.filter((position) => position.parent === "warehouse" && position.kind === "aisle");
  assert.deepEqual(warehouseOneAisles.map((position) => position.code), Array.from({ length: 12 }, (_, index) => `A${index + 1}`));
  for (const aisle of warehouseOneAisles) {
    const shelves = chino.positions.filter((position) => position.parent === aisle.key && position.kind === "shelf");
    assert.ok(shelves.length > 0, `${aisle.code} requires a shelf`);
    assert.ok(shelves.some((shelf) => chino.positions.some((position) => position.parent === shelf.key && position.kind === "bin" && position.stores)), `${aisle.code} requires a storage bin`);
  }
  assert.ok(DEMO_PARTS.every((part) => part.partNumber && !part.partNumber.startsWith("DEMO-")));
  assert.deepEqual(new Set(DEMO_PARTS.map((part) => part.tracking)), new Set(["quantity", "measured_bulk", "serialized"]));
  assert.ok(DEMO_PARTS.filter((part) => part.tracking === "quantity").length > DEMO_PARTS.filter((part) => part.tracking !== "quantity").length);
  assert.ok(DEMO_PARTS.some((part) => part.tracking === "measured_bulk" && part.uomCode === "qt"));
  assert.ok(DEMO_STOCK.some((stock) => DEMO_PARTS.find((part) => part.key === stock.part)?.tracking === "measured_bulk" && !Number.isInteger(stock.onHand)));
  assert.ok(DEMO_STOCK.filter((stock) => stock.serials).every((stock) => DEMO_PARTS.find((part) => part.key === stock.part)?.tracking === "serialized"));
  assert.ok(DEMO_STOCK.some((stock) => stock.reserved > 0));
  assert.ok(DEMO_PARTS.some((part) => !DEMO_STOCK.some((stock) => stock.part === part.key)));
  assert.deepEqual(new Set(DEMO_WORKORDERS.map((workorder) => workorder.request)), new Set(["approved", "submitted"]));
  assert.deepEqual(new Set(DEMO_WORKORDERS.filter((workorder) => workorder.usage).map((workorder) => workorder.usage)), new Set(["reserved", "consumed"]));
});
