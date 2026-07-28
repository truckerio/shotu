import assert from "node:assert/strict";
import test from "node:test";

import {
  isEditableElement,
  observeVisualViewport,
  readVisualViewportState,
} from "./useVisualViewport.js";

function element({ selector = "input", type = "text", editable = false } = {}) {
  return {
    type,
    disabled: false,
    readOnly: false,
    isContentEditable: editable,
    matches(query) {
      if (query === "[contenteditable='true']") return editable;
      if (query === "textarea, select") return selector === "textarea" || selector === "select";
      if (query === "input") return selector === "input";
      return false;
    },
  };
}

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
  };
}

test("keyboard requires an editable focus target and threshold breach", () => {
  const windowObject = {
    innerHeight: 800,
    visualViewport: { height: 620, offsetTop: 0 },
  };
  const documentObject = {
    documentElement: { clientHeight: 800 },
    activeElement: element(),
  };

  assert.deepEqual(readVisualViewportState({ windowObject, documentObject }), {
    keyboardOpen: true,
    viewportHeight: 620,
    viewportOffsetTop: 0,
    keyboardInset: 180,
  });

  windowObject.visualViewport.height = 680;
  assert.equal(readVisualViewportState({ windowObject, documentObject }).keyboardOpen, false);

  windowObject.visualViewport.height = 620;
  documentObject.activeElement = element({ selector: "button", type: "button" });
  assert.equal(readVisualViewportState({ windowObject, documentObject }).keyboardOpen, false);
});

test("keyboard detection keeps the last unobscured height when Android resizes layout and visual viewports", () => {
  const windowObject = {
    innerHeight: 520,
    visualViewport: { height: 520, offsetTop: 0 },
  };
  const documentObject = {
    documentElement: { clientHeight: 520 },
    activeElement: element(),
  };

  assert.deepEqual(readVisualViewportState({
    windowObject,
    documentObject,
    layoutHeightBaseline: 800,
  }), {
    keyboardOpen: true,
    viewportHeight: 520,
    viewportOffsetTop: 0,
    keyboardInset: 280,
  });
});

test("editable detection supports text controls and contenteditable only", () => {
  assert.equal(isEditableElement(element()), true);
  assert.equal(isEditableElement(element({ selector: "textarea" })), true);
  assert.equal(isEditableElement(element({ selector: "div", editable: true })), true);
  assert.equal(isEditableElement(element({ type: "checkbox" })), false);
  assert.equal(isEditableElement(null), false);
});

test("observer coalesces events and removes every listener", () => {
  const windowEvents = eventTarget();
  const viewportEvents = eventTarget();
  let frameCallback = null;
  let cancelledFrame = null;
  const windowObject = {
    ...windowEvents,
    innerHeight: 800,
    visualViewport: { ...viewportEvents, height: 600, offsetTop: 0 },
    requestAnimationFrame(callback) {
      frameCallback = callback;
      return 17;
    },
    cancelAnimationFrame(id) {
      cancelledFrame = id;
    },
  };
  const documentObject = {
    documentElement: { clientHeight: 800 },
    activeElement: element(),
  };
  const changes = [];

  const cleanup = observeVisualViewport({
    windowObject,
    documentObject,
    onChange: (state) => changes.push(state),
  });

  assert.deepEqual([...windowEvents.listeners.keys()].sort(), [
    "focusin",
    "focusout",
    "orientationchange",
  ]);
  assert.deepEqual([...viewportEvents.listeners.keys()].sort(), ["resize", "scroll"]);
  frameCallback();
  assert.equal(changes.length, 1);

  windowEvents.listeners.get("focusin")();
  cleanup();
  assert.equal(cancelledFrame, 17);
  assert.equal(windowEvents.listeners.size, 0);
  assert.equal(viewportEvents.listeners.size, 0);
});
