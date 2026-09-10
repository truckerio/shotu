import assert from "node:assert/strict";
import test from "node:test";
import { serializedPickerMaxHeight, serializedPickerPlacement } from "./serialized-picker-placement.js";

test("serialized picker mirrors its responsive CSS height ceilings", () => {
  assert.equal(serializedPickerMaxHeight({ viewportWidth: 1422, viewportHeight: 800 }), 544);
  assert.equal(serializedPickerMaxHeight({ viewportWidth: 768, viewportHeight: 800 }), 448);
  assert.equal(serializedPickerMaxHeight({ viewportWidth: 390, viewportHeight: 800 }), 384);
  assert.equal(serializedPickerMaxHeight({ viewportWidth: 390, viewportHeight: 220 }), 76);
});

test("serialized picker flips above its Part field when it cannot fit below", () => {
  assert.deepEqual(serializedPickerPlacement({
    anchorRect: { top: 640, bottom: 684 }, pickerHeight: 420, viewportHeight: 800,
  }), { side: "above", maxHeight: 420 });
});

test("serialized picker uses the larger side and caps its height when neither side fits", () => {
  assert.deepEqual(serializedPickerPlacement({
    anchorRect: { top: 330, bottom: 374 }, pickerHeight: 600, viewportHeight: 700,
  }), { side: "above", maxHeight: 308 });
});

test("serialized picker honors a mobile visual viewport offset", () => {
  assert.deepEqual(serializedPickerPlacement({
    anchorRect: { top: 620, bottom: 664 }, pickerHeight: 420, viewportHeight: 500, viewportOffsetTop: 300,
  }), { side: "above", maxHeight: 298 });
});
