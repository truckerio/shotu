import assert from "node:assert/strict";
import test from "node:test";
import { discountDisplay } from "./discount-display.js";

test("empty and invalid discounts display a dash", () => {
  for (const discount of [null, { kind: "fixed", value: "" }, { kind: "fixed", value: "bad" }, { kind: "fixed", value: -1 }]) {
    assert.equal(discountDisplay(discount), "—");
  }
});
test("fixed amounts use only compact currency, preserving cents", () => {
  assert.equal(discountDisplay({ kind: "fixed", value: "45" }), "$45");
  assert.equal(discountDisplay({ kind: "fixed", value: "45.50" }), "$45.50");
  assert.equal(discountDisplay({ kind: "fixed", value: "0" }), "$0");
});
test("percentage uses the authoritative preview amount, never a client calculation", () => {
  const discount = { kind: "percentage", value: "14" };
  assert.equal(discountDisplay(discount), "14% · —");
  assert.equal(discountDisplay(discount, { discount: "28", currency: "USD" }), "14% · —");
  assert.equal(discountDisplay(discount, { financialFingerprint: "current", discount: "28", currency: "USD" }), "14% · $28");
  assert.equal(discountDisplay(discount, { financialFingerprint: "current", discount: null }), "14% · —");
});
