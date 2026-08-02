const ROLE_PATHS = Object.freeze({
  admin: "/?adminView=operations",
  office: "/?view=office",
  mechanic: "/",
  surveillance: "/",
});

const ROLE_ROW_SELECTORS = Object.freeze({
  admin: ".operations-row",
  office: ".office-queue-task, .operations-row",
  mechanic: ".mechanic-queue-item, .workorder-list-item, .operations-row",
  surveillance: ".surveillance-workorder, .operations-row",
});

function positiveNumber(value, fallback, name) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number.`);
  return parsed;
}

export function parseBrowserBenchmarkConfig(env = process.env) {
  const role = String(env.PERF_BROWSER_ROLE || "admin").trim().toLowerCase();
  if (!ROLE_PATHS[role]) throw new Error(`PERF_BROWSER_ROLE must be one of ${Object.keys(ROLE_PATHS).join(", ")}.`);
  const identifier = String(env.PERF_BROWSER_IDENTIFIER || "").trim();
  const password = String(env.PERF_BROWSER_PASSWORD || "");
  if (!identifier || !password) throw new Error("PERF_BROWSER_IDENTIFIER and PERF_BROWSER_PASSWORD are required.");
  const baseUrl = new URL(env.PERF_BROWSER_BASE_URL || "http://localhost:4173");
  if (!["http:", "https:"].includes(baseUrl.protocol)) throw new Error("PERF_BROWSER_BASE_URL must use HTTP or HTTPS.");
  return {
    role,
    identifier,
    password,
    baseUrl,
    path: ROLE_PATHS[role],
    rowSelector: ROLE_ROW_SELECTORS[role],
    viewport: { width: 390, height: 844 },
    budgets: {
      listReadyMs: positiveNumber(env.PERF_BROWSER_MAX_LIST_READY_MS, 2500, "PERF_BROWSER_MAX_LIST_READY_MS"),
      maxLongTaskMs: positiveNumber(env.PERF_BROWSER_MAX_LONG_TASK_MS, 200, "PERF_BROWSER_MAX_LONG_TASK_MS"),
      maxFrameMs: positiveNumber(env.PERF_BROWSER_MAX_FRAME_MS, 50, "PERF_BROWSER_MAX_FRAME_MS"),
    },
    reportPath: String(env.PERF_BROWSER_REPORT_PATH || ".tmp/performance/mobile-render-baseline.json").trim(),
  };
}

export function publicBrowserConfig(config) {
  return {
    role: config.role,
    targetOrigin: config.baseUrl.origin,
    path: config.path,
    viewport: config.viewport,
    budgets: config.budgets,
    reportPath: config.reportPath,
    credentialsConfigured: true,
  };
}
