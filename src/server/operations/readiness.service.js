import { query } from "../db/pool.js";

const DEFAULT_TIMEOUT_MS = 2_000;

export async function checkReadiness({
  queryDatabase = query,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const startedAt = performance.now();
  let timeout;
  try {
    await Promise.race([
      queryDatabase("select 1 as ready"),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Database readiness check timed out.")),
          timeoutMs,
        );
        timeout.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  return {
    status: "ready",
    database: "available",
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
}
