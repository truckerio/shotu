import assert from "node:assert/strict";
import test from "node:test";

import { anchoredOverlayShift } from "./anchored-overlay-position.js";

test("anchored overlay remains still when it fits in the viewport", () => {
  assert.deepEqual(anchoredOverlayShift({
    rect: { right: 700, bottom: 500 },
    viewportWidth: 768,
    viewportHeight: 700,
  }), { x: 0, y: 0 });
});

test("replacement overlay retains correction inside clipped tablet container", () => {
  assert.deepEqual(anchoredOverlayShift({
    rect: { right: 960, bottom: 820 },
    currentShift: { x: 0, y: 0 },
    viewportWidth: 768,
    viewportHeight: 700,
  }), { x: 208, y: 136 });

  assert.deepEqual(anchoredOverlayShift({
    rect: { right: 752, bottom: 684 },
    currentShift: { x: 208, y: 136 },
    viewportWidth: 768,
    viewportHeight: 700,
  }), { x: 208, y: 136 });
});

test("sub-pixel measurements converge to one stable viewport correction", () => {
  const first = anchoredOverlayShift({
    rect: { right: 901.2, bottom: 715.1 },
    viewportWidth: 900,
    viewportHeight: 700,
  });
  assert.deepEqual(first, { x: 18, y: 32 });
  assert.deepEqual(anchoredOverlayShift({
    rect: { right: 883.2, bottom: 683.1 },
    currentShift: first,
    viewportWidth: 900,
    viewportHeight: 700,
  }), first);
});
