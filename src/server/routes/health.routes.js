import { checkReadiness } from "../operations/readiness.service.js";

export async function handleHealthRoute(req, res, url, {
  sendJson,
  readinessCheck = checkReadiness,
} = {}) {
  if (req.method !== "GET") return false;

  if (url.pathname === "/health/live") {
    sendJson(res, 200, { status: "alive" });
    return true;
  }

  if (url.pathname !== "/health/ready") return false;

  try {
    sendJson(res, 200, await readinessCheck());
  } catch {
    sendJson(res, 503, {
      status: "not_ready",
      database: "unavailable",
    });
  }
  return true;
}
