import test from "node:test";
import assert from "node:assert/strict";
import { partStockTracking, stockIntakeQuantity, stockIntakeRequestKey, clearStockIntakeRequestKey } from "../../components/inventory/stock-intake-model.js";

test("saved tracking selects quantity, measured or exact-unit workflow", () => {
  assert.equal(partStockTracking({ trackingMode: "quantity", uomCode: "pc", inventory: { serializationRequired: true } }), "quantity");
  assert.equal(partStockTracking({ trackingMode: "serialized", uomCode: "ea", inventory: null }), "serialized");
  assert.equal(partStockTracking({ trackingMode: "measured_bulk", uomCode: "gal" }), "measured_bulk");
  assert.equal(partStockTracking({ trackingMode: "serialized", uomCode: "gal" }), "unsupported");
  assert.equal(partStockTracking({ uomCode: "pc" }), "unreviewed");
  assert.equal(partStockTracking({ uomCode: "pc", inventory: { serializationRequired: true } }), "serialized");
  assert.equal(partStockTracking({ uomCode: "gal" }), "measured_bulk");
  assert.equal(partStockTracking({ uomCode: "hr" }), "unsupported");
});

test("whole counts and canonical bulk precision reject fractional or invalid intake", () => {
  for (const value of ["", "-1", "0", "NaN", "Infinity", "1.5", "1000000"]) assert.equal(stockIntakeQuantity(value, { uomCode: "pc" }).valid, false, value);
  assert.equal(stockIntakeQuantity("12", { uomCode: "pc" }).valid, true);
  assert.equal(stockIntakeQuantity("1.125", { uomCode: "gal" }).valid, true);
  assert.equal(stockIntakeQuantity("1.0001", { uomCode: "gal" }).valid, false);
  assert.equal(stockIntakeQuantity("1e-10", { uomCode: "gal" }).valid, false);
  assert.equal(stockIntakeQuantity("1.005", { uomCode: "gal" }).valid, true);
  assert.equal(stockIntakeQuantity("1", { uomCode: "invalid" }).valid, false);
  assert.equal(stockIntakeQuantity("1", { uomCode: "gal", canonicalUomCode: "l" }).uomCode, "l");
});

test("failed or dismissed intake reuses its key, while confirmed success starts a new receipt", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const first = stockIntakeRequestKey("test-part-location-12", storage);
  assert.equal(stockIntakeRequestKey("test-part-location-12", storage), first);
  assert.notEqual(stockIntakeRequestKey("test-part-location-13", storage), first);
  clearStockIntakeRequestKey("test-part-location-12", storage);
  assert.notEqual(stockIntakeRequestKey("test-part-location-12", storage), first);
});
