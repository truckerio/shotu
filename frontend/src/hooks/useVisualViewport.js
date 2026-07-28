import { useEffect, useState } from "react";

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

export function isEditableElement(element) {
  if (!element || typeof element.matches !== "function") return false;
  if (element.isContentEditable || element.matches("[contenteditable='true']")) return true;
  if (element.matches("textarea, select")) return !element.disabled && !element.readOnly;
  if (!element.matches("input")) return false;

  const type = String(element.type || "text").toLowerCase();
  return !element.disabled && !element.readOnly && !NON_TEXT_INPUT_TYPES.has(type);
}

function layoutViewportHeight(windowObject, documentObject) {
  return Number(documentObject?.documentElement?.clientHeight)
    || Number(windowObject?.innerHeight)
    || 0;
}

export function readVisualViewportState({
  windowObject,
  documentObject,
  keyboardThreshold = 120,
  layoutHeightBaseline = 0,
} = {}) {
  const layoutHeight = Math.max(
    layoutViewportHeight(windowObject, documentObject),
    Number(layoutHeightBaseline) || 0,
  );
  const visualViewport = windowObject?.visualViewport;
  const viewportHeight = Number(visualViewport?.height) || layoutHeight;
  const viewportOffsetTop = Number(visualViewport?.offsetTop) || 0;
  const heightDifference = Math.max(0, layoutHeight - viewportHeight);
  const keyboardOpen = Boolean(
    visualViewport
    && isEditableElement(documentObject?.activeElement)
    && heightDifference > keyboardThreshold,
  );

  return {
    keyboardOpen,
    viewportHeight,
    viewportOffsetTop,
    keyboardInset: keyboardOpen
      ? Math.max(0, layoutHeight - viewportHeight - viewportOffsetTop)
      : 0,
  };
}

const EMPTY_VIEWPORT_STATE = Object.freeze({
  keyboardOpen: false,
  viewportHeight: 0,
  viewportOffsetTop: 0,
  keyboardInset: 0,
});

function sameViewportState(left, right) {
  return left.keyboardOpen === right.keyboardOpen
    && left.viewportHeight === right.viewportHeight
    && left.viewportOffsetTop === right.viewportOffsetTop
    && left.keyboardInset === right.keyboardInset;
}

export function observeVisualViewport({
  windowObject,
  documentObject,
  keyboardThreshold = 120,
  onChange,
}) {
  if (!windowObject || !documentObject || typeof onChange !== "function") {
    return () => {};
  }

  const visualViewport = windowObject.visualViewport;
  let animationFrame = null;
  let disposed = false;
  let layoutHeightBaseline = layoutViewportHeight(windowObject, documentObject);

  const read = () => {
    animationFrame = null;
    if (disposed) return;
    const measuredLayoutHeight = layoutViewportHeight(windowObject, documentObject);
    if (!isEditableElement(documentObject.activeElement)) {
      layoutHeightBaseline = measuredLayoutHeight;
    }
    onChange(readVisualViewportState({
      windowObject,
      documentObject,
      keyboardThreshold,
      layoutHeightBaseline,
    }));
  };
  const scheduleRead = () => {
    if (animationFrame !== null) return;
    animationFrame = windowObject.requestAnimationFrame(read);
  };

  visualViewport?.addEventListener("resize", scheduleRead);
  visualViewport?.addEventListener("scroll", scheduleRead);
  windowObject.addEventListener("focusin", scheduleRead);
  windowObject.addEventListener("focusout", scheduleRead);
  const handleOrientationChange = () => {
    layoutHeightBaseline = layoutViewportHeight(windowObject, documentObject);
    scheduleRead();
  };

  windowObject.addEventListener("orientationchange", handleOrientationChange);
  scheduleRead();

  return () => {
    disposed = true;
    if (animationFrame !== null) windowObject.cancelAnimationFrame(animationFrame);
    visualViewport?.removeEventListener("resize", scheduleRead);
    visualViewport?.removeEventListener("scroll", scheduleRead);
    windowObject.removeEventListener("focusin", scheduleRead);
    windowObject.removeEventListener("focusout", scheduleRead);
    windowObject.removeEventListener("orientationchange", handleOrientationChange);
  };
}

export function useVisualViewport({ keyboardThreshold = 120 } = {}) {
  const [state, setState] = useState(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return EMPTY_VIEWPORT_STATE;
    }
    return readVisualViewportState({
      windowObject: window,
      documentObject: document,
      keyboardThreshold,
    });
  });

  useEffect(() => observeVisualViewport({
    windowObject: window,
    documentObject: document,
    keyboardThreshold,
    onChange(nextState) {
      setState((currentState) => (
        sameViewportState(currentState, nextState) ? currentState : nextState
      ));
    },
  }), [keyboardThreshold]);

  return state;
}
