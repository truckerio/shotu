import {
  MAP_CLOSE_DELAY_MS,
  MAP_OPEN_DELAY_MS,
  MAP_SURFACE_TRANSITION_MS,
} from "../ui-timings.js";

export function createMapVisibilityController({
  onCollapse,
  onExpand,
  onMount,
  onUnmount,
  schedule = globalThis.setTimeout,
  cancel = globalThis.clearTimeout,
}) {
  let openTimer = null;
  let closeTimer = null;
  let unmountTimer = null;

  function clearOpen() {
    if (openTimer === null) return;
    cancel(openTimer);
    openTimer = null;
  }

  function clearClose() {
    if (closeTimer === null) return;
    cancel(closeTimer);
    closeTimer = null;
  }

  function clearUnmount() {
    if (unmountTimer === null) return;
    cancel(unmountTimer);
    unmountTimer = null;
  }

  function expand() {
    clearOpen();
    clearClose();
    clearUnmount();
    onMount();
    onExpand();
  }

  function collapse() {
    clearOpen();
    clearClose();
    clearUnmount();
    onCollapse();
    unmountTimer = schedule(() => {
      unmountTimer = null;
      onUnmount();
    }, MAP_SURFACE_TRANSITION_MS);
  }

  return {
    open({ immediate = false } = {}) {
      clearClose();
      clearUnmount();
      if (immediate) {
        expand();
        return;
      }
      if (openTimer !== null) return;
      openTimer = schedule(() => {
        openTimer = null;
        expand();
      }, MAP_OPEN_DELAY_MS);
    },

    close({ immediate = false } = {}) {
      clearOpen();
      clearClose();
      if (immediate) {
        collapse();
        return;
      }
      closeTimer = schedule(() => {
        closeTimer = null;
        collapse();
      }, MAP_CLOSE_DELAY_MS);
    },

    cancelClose() {
      clearClose();
      clearUnmount();
    },

    reset() {
      clearOpen();
      clearClose();
      clearUnmount();
      onCollapse();
      onUnmount();
    },

    dispose() {
      clearOpen();
      clearClose();
      clearUnmount();
    },
  };
}
