import assert from "node:assert/strict";
import test from "node:test";

import {
  fieldScrollDelta,
  nearestScrollableAncestor,
  revealFocusedField,
} from "./useFocusedFieldVisibility.js";

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

test("real form controls use scrollIntoView to reveal every scrollable ancestor", () => {
  const calls = [];
  const moved = revealFocusedField({
    element: {
      getBoundingClientRect: () => ({ top: 570, bottom: 630 }),
      scrollIntoView: (options) => calls.push(options),
    },
    container: {
      getBoundingClientRect: () => ({ top: 100, bottom: 700 }),
      scrollBy: () => assert.fail("scrollIntoView must own the primary reveal"),
    },
    margin: 12,
    windowObject: {
      innerHeight: 800,
      visualViewport: { height: 620, offsetTop: 0 },
    },
  });

  assert.equal(moved, true);
  assert.deepEqual(calls, [{ behavior: "auto", block: "center", inline: "nearest" }]);
});

test("focused fields use their nearest vertical scroll owner when none is supplied", () => {
  const calls = [];
  const scrollOwner = {
    clientHeight: 300,
    scrollHeight: 900,
    parentElement: null,
    getBoundingClientRect: () => ({ top: 100, bottom: 400 }),
    scrollBy: (options) => calls.push(options),
  };
  const element = {
    parentElement: scrollOwner,
    getBoundingClientRect: () => ({ top: 370, bottom: 430 }),
  };
  const windowObject = {
    getComputedStyle: (node) => ({ overflowY: node === scrollOwner ? "auto" : "visible" }),
    innerHeight: 800,
    visualViewport: { height: 420, offsetTop: 0 },
    scrollBy: () => assert.fail("the page must not scroll when a field has a scroll owner"),
  };

  assert.equal(nearestScrollableAncestor(element, windowObject), scrollOwner);
  assert.equal(revealFocusedField({ element, margin: 12, windowObject }), true);
  assert.deepEqual(calls, [{ top: 42, left: 0, behavior: "auto" }]);
});
