import { useEffect, useRef } from "react";

export const AUTOMATIC_REFRESH_INTERVAL_MS = 30_000;
export const LIVE_QUEUE_REFRESH_INTERVAL_MS = 3_000;
export const MAX_AUTOMATIC_REFRESH_BACKOFF_MS = 30_000;

export function createLatestRequestGuard() {
  let generation = 0;
  return {
    begin() { generation += 1; return generation; },
    isCurrent(candidate) { return candidate === generation; },
  };
}

export function createAutomaticRefreshController(callback, {
  intervalMs = AUTOMATIC_REFRESH_INTERVAL_MS,
  maxBackoffMs = MAX_AUTOMATIC_REFRESH_BACKOFF_MS,
  windowObject = window,
  documentObject = document,
  now = Date.now,
  random = Math.random,
} = {}) {
  let running = false;
  let stopped = false;
  let failures = 0;
  let nextAllowedAt = 0;
  let activeController = null;

  const refresh = async ({ force = false } = {}) => {
    if (stopped || running || documentObject.visibilityState !== "visible") return false;
    if (!force && now() < nextAllowedAt) return false;
    running = true;
    activeController = new AbortController();
    try {
      const result = await callback({ signal: activeController.signal });
      if (stopped || activeController.signal.aborted) return false;
      if (result === false) throw new Error("Automatic refresh did not complete.");
      failures = 0;
      nextAllowedAt = 0;
      return true;
    } catch {
      if (!stopped && !activeController.signal.aborted) {
        failures += 1;
        const exponentialDelay = Math.min(maxBackoffMs, intervalMs * (2 ** failures));
        nextAllowedAt = now() + exponentialDelay + Math.floor(random() * intervalMs);
      }
      return false;
    } finally {
      activeController = null;
      running = false;
    }
  };
  const requestRefresh = () => { void refresh(); };
  const refreshWhenVisible = () => {
    if (documentObject.visibilityState === "visible") void refresh({ force: true });
  };
  const interval = windowObject.setInterval(requestRefresh, intervalMs);

  windowObject.addEventListener("focus", requestRefresh);
  documentObject.addEventListener("visibilitychange", refreshWhenVisible);

  return {
    refresh,
    stop() {
      if (stopped) return;
      stopped = true;
      activeController?.abort();
      windowObject.clearInterval(interval);
      windowObject.removeEventListener("focus", requestRefresh);
      documentObject.removeEventListener("visibilitychange", refreshWhenVisible);
    },
  };
}

export function useAutomaticRefresh(callback, { enabled = true, intervalMs = AUTOMATIC_REFRESH_INTERVAL_MS } = {}) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = createAutomaticRefreshController(
      (context) => callbackRef.current(context),
      { intervalMs },
    );
    return () => controller.stop();
  }, [enabled, intervalMs]);
}
