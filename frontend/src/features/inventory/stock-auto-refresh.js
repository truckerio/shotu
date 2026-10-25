export const STOCK_REFRESH_INTERVAL_MS = 15_000;

// The stream invalidates reads; the read owner retains pagination, errors and drafts.
export function startStockAutoRefresh({ refresh, canRefresh, documentTarget = document,
  windowTarget = window, intervalMs = STOCK_REFRESH_INTERVAL_MS, now = Date.now,
  createEventSource = () => new windowTarget.EventSource("/api/office/inventory/events") }) {
  let stopped = false;
  let running = false;
  let connected = false;
  let pending = true;
  let lastAttempt = -Infinity;
  let request;
  let deferred;
  let stream;
  async function check() {
    if (stopped || running || !pending || documentTarget.visibilityState !== "visible"
      || windowTarget.navigator?.onLine === false || !canRefresh()) return;
    const delay = 1000 - (now() - lastAttempt);
    if (delay > 0) {
      if (!deferred) deferred = windowTarget.setTimeout(() => { deferred = null; void check(); }, delay);
      return;
    }
    running = true;
    pending = false;
    lastAttempt = now();
    request = new AbortController();
    try { if (await refresh({ signal: request.signal }) === false) pending = true; }
    catch { /* The read owner reports failures and offers Retry. */ }
    finally { running = false; if (pending) void check(); }
  }
  function invalidate() { pending = true; return check(); }
  function ready() { connected = true; return invalidate(); }
  function disconnected() { connected = false; }
  function recover() { if (!connected) pending = true; return check(); }
  try {
    stream = createEventSource();
    stream.addEventListener("ready", ready);
    stream.addEventListener("inventory-change", invalidate);
    stream.addEventListener("error", disconnected);
  } catch { /* EventSource unavailable: retain the recovery reads. */ }
  const timer = windowTarget.setInterval(() => { if (!connected) pending = true; return check(); }, intervalMs);
  windowTarget.addEventListener("focus", recover);
  windowTarget.addEventListener("online", recover);
  documentTarget.addEventListener("visibilitychange", recover);
  void check();
  const stop = () => {
    stopped = true;
    request?.abort();
    stream?.close();
    windowTarget.clearInterval(timer);
    if (deferred) windowTarget.clearTimeout(deferred);
    windowTarget.removeEventListener("focus", recover);
    windowTarget.removeEventListener("online", recover);
    documentTarget.removeEventListener("visibilitychange", recover);
  };
  stop.check = check;
  return stop;
}
