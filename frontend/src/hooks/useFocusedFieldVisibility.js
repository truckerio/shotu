import { useCallback, useEffect } from "react";

export function nearestScrollableAncestor(element, windowObject) {
  if (!element || !windowObject?.getComputedStyle) return null;
  let ancestor = element.parentElement;
  while (ancestor) {
    const { overflowY } = windowObject.getComputedStyle(ancestor);
    if (/(auto|scroll|overlay)/.test(overflowY)
      && Number(ancestor.scrollHeight) > Number(ancestor.clientHeight)) {
      return ancestor;
    }
    ancestor = ancestor.parentElement;
  }
  return null;
}

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

  const scrollContainer = container || nearestScrollableAncestor(element, windowObject);
  const visualViewport = windowObject.visualViewport;
  const viewportTop = Number(visualViewport?.offsetTop) || 0;
  const viewportBottom = viewportTop
    + (Number(visualViewport?.height) || Number(windowObject.innerHeight) || 0);
  const delta = fieldScrollDelta({
    fieldRect: element.getBoundingClientRect(),
    containerRect: scrollContainer?.getBoundingClientRect?.(),
    viewportTop,
    viewportBottom,
    margin,
  });

  if (Math.abs(delta) < 1) return false;
  if (typeof element.scrollIntoView === "function") {
    element.scrollIntoView({
      behavior: "auto",
      block: "center",
      inline: "nearest",
    });
    return true;
  }
  if (scrollContainer && typeof scrollContainer.scrollBy === "function") {
    scrollContainer.scrollBy({ top: delta, left: 0, behavior: "auto" });
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
    const retryTimers = new Set();
    let pendingElement = null;
    const cancelPendingReveal = () => {
      if (firstFrame !== null) window.cancelAnimationFrame(firstFrame);
      if (settledFrame !== null) window.cancelAnimationFrame(settledFrame);
      firstFrame = null;
      settledFrame = null;
      for (const timer of retryTimers) window.clearTimeout(timer);
      retryTimers.clear();
    };
    const scheduleReveal = (element = null) => {
      pendingElement = element;
      cancelPendingReveal();
      firstFrame = window.requestAnimationFrame(() => {
        firstFrame = null;
        settledFrame = window.requestAnimationFrame(() => {
          settledFrame = null;
          ensureFieldVisible(pendingElement);
        });
      });
      // Mobile keyboards animate after focus. Recheck after both the early and
      // final animation phases so Safari/iPadOS and Android converge on the
      // actual visible viewport rather than the pre-keyboard layout viewport.
      for (const delay of [160, 420]) {
        const timer = window.setTimeout(() => {
          retryTimers.delete(timer);
          ensureFieldVisible(pendingElement);
        }, delay);
        retryTimers.add(timer);
      }
    };
    const revealFocusedTarget = (event) => scheduleReveal(event?.target);
    scheduleReveal();
    window.addEventListener("focusin", revealFocusedTarget);
    window.visualViewport?.addEventListener("resize", scheduleReveal);
    window.visualViewport?.addEventListener("scroll", scheduleReveal);
    return () => {
      window.removeEventListener("focusin", revealFocusedTarget);
      window.visualViewport?.removeEventListener("resize", scheduleReveal);
      window.visualViewport?.removeEventListener("scroll", scheduleReveal);
      cancelPendingReveal();
    };
  }, [enabled, ensureFieldVisible, keyboardOpen]);

  return ensureFieldVisible;
}
