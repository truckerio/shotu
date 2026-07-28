import { useCallback, useEffect } from "react";

export function fieldScrollDelta({
  fieldRect,
  containerRect,
  viewportTop,
  viewportBottom,
  margin = 12,
}) {
  const visibleTop = Math.max(viewportTop, containerRect?.top ?? viewportTop) + margin;
  const visibleBottom = Math.min(viewportBottom, containerRect?.bottom ?? viewportBottom) - margin;

  if (fieldRect.top < visibleTop) return fieldRect.top - visibleTop;
  if (fieldRect.bottom > visibleBottom) return fieldRect.bottom - visibleBottom;
  return 0;
}

export function revealFocusedField({
  element,
  container,
  margin = 12,
  windowObject,
}) {
  if (!element || typeof element.getBoundingClientRect !== "function" || !windowObject) {
    return false;
  }

  const visualViewport = windowObject.visualViewport;
  const viewportTop = Number(visualViewport?.offsetTop) || 0;
  const viewportBottom = viewportTop
    + (Number(visualViewport?.height) || Number(windowObject.innerHeight) || 0);
  const delta = fieldScrollDelta({
    fieldRect: element.getBoundingClientRect(),
    containerRect: container?.getBoundingClientRect?.(),
    viewportTop,
    viewportBottom,
    margin,
  });

  if (Math.abs(delta) < 1) return false;
  if (container && typeof container.scrollBy === "function") {
    container.scrollBy({ top: delta, left: 0, behavior: "auto" });
  } else if (typeof windowObject.scrollBy === "function") {
    windowObject.scrollBy({ top: delta, left: 0, behavior: "auto" });
  }
  return true;
}

export function useFocusedFieldVisibility({
  enabled,
  containerRef,
  keyboardOpen,
  margin = 12,
}) {
  const ensureFieldVisible = useCallback((element) => {
    if (!enabled || typeof window === "undefined" || typeof document === "undefined") {
      return false;
    }
    return revealFocusedField({
      element: element || document.activeElement,
      container: containerRef?.current || null,
      margin,
      windowObject: window,
    });
  }, [containerRef, enabled, margin]);

  useEffect(() => {
    if (!enabled || !keyboardOpen || typeof window === "undefined") return undefined;

    let firstFrame = null;
    let settledFrame = null;
    firstFrame = window.requestAnimationFrame(() => {
      settledFrame = window.requestAnimationFrame(() => ensureFieldVisible());
    });
    return () => {
      if (firstFrame !== null) window.cancelAnimationFrame(firstFrame);
      if (settledFrame !== null) window.cancelAnimationFrame(settledFrame);
    };
  }, [enabled, ensureFieldVisible, keyboardOpen]);

  return ensureFieldVisible;
}
