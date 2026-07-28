import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  numericValue,
  quantityLabel,
  quantitySchema,
  uomCodeSchema,
  validateQuantityUnit,
} from "./quantity-uom.js";

const inputSchema = z.object({
  quantity: quantitySchema,
  uomCode: uomCodeSchema,
}).superRefine(validateQuantityUnit);

test("legacy quantities default to each and count units reject decimals", () => {
  assert.deepEqual(inputSchema.parse({ quantity: 2 }), { quantity: 2, uomCode: "ea" });
  assert.equal(inputSchema.safeParse({ quantity: 2.5, uomCode: "ea" }).success, false);
  assert.equal(inputSchema.safeParse({ quantity: 2.5, uomCode: "case" }).success, false);
});

test("measured units accept three decimal places", () => {
  assert.deepEqual(inputSchema.parse({ quantity: "2.375", uomCode: "gal" }), {
    quantity: 2.375,
    uomCode: "gal",
  });
  assert.equal(inputSchema.safeParse({ quantity: 12.7504, uomCode: "lb" }).success, false);
});

test("database numeric strings normalize before inventory arithmetic and display", () => {
  assert.equal(numericValue("12.750"), 12.75);
  assert.equal(numericValue("not-numeric"), 0);
  assert.equal(quantityLabel("80.000", "ft3"), "80 ft³");
});
