import assert from "node:assert/strict";
import test from "node:test";
import { quantityUnitMenuPlacement } from "./quantity-unit-placement-model.js";

test("unit menu flips above when the bottom viewport space is insufficient", () => {
  assert.deepEqual(quantityUnitMenuPlacement({
    triggerRect: { top: 620, bottom: 660 }, menuHeight: 360, viewportHeight: 700,
  }), { placement: "above", maxHeight: 360 });
});

test("unit menu clamps its scrollable height to the available viewport space", () => {
  assert.deepEqual(quantityUnitMenuPlacement({
    triggerRect: { top: 100, bottom: 140 }, menuHeight: 360, viewportHeight: 250,
  }), { placement: "below", maxHeight: 88 });
});

test("mobile unit menu stays within the visual viewport", () => {
  assert.deepEqual(quantityUnitMenuPlacement({
    triggerRect: { top: 620, bottom: 664 }, menuHeight: 420, viewportHeight: 500, viewportOffsetTop: 300, isMobile: true,
  }), { placement: "above", maxHeight: 298, top: 316 });
});
