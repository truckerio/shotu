import assert from "node:assert/strict";
import test from "node:test";

import { fieldScrollDelta, revealFocusedField } from "./useFocusedFieldVisibility.js";

test("field scroll delta keeps requested margin above keyboard", () => {
  const delta = fieldScrollDelta({
    fieldRect: { top: 570, bottom: 630 },
    containerRect: { top: 100, bottom: 700 },
    viewportTop: 0,
    viewportBottom: 620,
    margin: 12,
  });
  assert.equal(delta, 22);
});

test("field scroll delta handles obscured fields above container", () => {
  const delta = fieldScrollDelta({
    fieldRect: { top: 90, bottom: 130 },
    containerRect: { top: 100, bottom: 700 },
    viewportTop: 0,
    viewportBottom: 620,
    margin: 12,
  });
  assert.equal(delta, -22);
});

test("reveal scrolls supplied container vertically without horizontal movement", () => {
  const calls = [];
  const moved = revealFocusedField({
    element: { getBoundingClientRect: () => ({ top: 570, bottom: 630 }) },
    container: {
      getBoundingClientRect: () => ({ top: 100, bottom: 700 }),
      scrollBy: (options) => calls.push(options),
    },
    margin: 12,
    windowObject: {
      innerHeight: 800,
      visualViewport: { height: 620, offsetTop: 0 },
      scrollBy: () => assert.fail("window must not scroll when a container is supplied"),
    },
  });

  assert.equal(moved, true);
  assert.deepEqual(calls, [{ top: 22, left: 0, behavior: "auto" }]);
});

test("visible fields do not scroll", () => {
  const moved = revealFocusedField({
    element: { getBoundingClientRect: () => ({ top: 200, bottom: 250 }) },
    container: { getBoundingClientRect: () => ({ top: 100, bottom: 700 }) },
    windowObject: { innerHeight: 800, visualViewport: { height: 620, offsetTop: 0 } },
  });
  assert.equal(moved, false);
});
