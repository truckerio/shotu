import { randomUUID } from "node:crypto";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/;

export function requestIdFor(req) {
  const supplied = String(req.headers?.["x-request-id"] || "").trim();
  return REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
}

export async function emitStructuredEvent(event, { logger = console } = {}) {
  logger.log(JSON.stringify(event));
  return event;
}

export function observeRequest(req, res, {
  logger = console,
  now = () => performance.now(),
} = {}) {
  const requestId = requestIdFor(req);
  const startedAt = now();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  res.once("finish", () => {
    const url = new URL(req.url || "/", `http://${req.headers?.host || "localhost"}`);
    if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/health/")) return;
    logger.log(JSON.stringify({
      type: "http_request",
      requestId,
      method: req.method,
      path: url.pathname,
      status: res.statusCode,
      durationMs: Math.max(0, Math.round(now() - startedAt)),
    }));
  });

  return requestId;
}

export function installGracefulShutdown(server, {
  closeDatabase,
  stopBackgroundJobs = () => {},
  logger = console,
  timeoutMs = 10_000,
} = {}) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(JSON.stringify({ type: "shutdown_started", signal }));
    stopBackgroundJobs();

    const forcedExit = setTimeout(() => {
      logger.error(JSON.stringify({ type: "shutdown_forced", signal }));
      process.exitCode = 1;
      server.closeAllConnections?.();
    }, timeoutMs);
    forcedExit.unref?.();

    await new Promise((resolve) => server.close(resolve));
    await closeDatabase?.();
    clearTimeout(forcedExit);
    logger.log(JSON.stringify({ type: "shutdown_complete", signal }));
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  return shutdown;
}
