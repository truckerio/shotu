import process from "node:process";
import { endpointBudgets } from "./route-catalog.js";

const ROLE_NAMES = ["admin", "office", "mechanic", "surveillance"];
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function integer(value, fallback, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function number(value, fallback, name, { min = 0, max = Number.MAX_VALUE } = {}) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}.`);
  }
  return parsed;
}

function boolean(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return TRUE_VALUES.has(String(value).trim().toLowerCase());
}

function roles(value = "admin,office,mechanic,surveillance") {
  const selected = [...new Set(value.split(",").map((role) => role.trim().toLowerCase()).filter(Boolean))];
  if (!selected.length) throw new Error("LOAD_ROLES must select at least one role.");
  const invalid = selected.filter((role) => !ROLE_NAMES.includes(role));
  if (invalid.length) throw new Error(`LOAD_ROLES contains unsupported roles: ${invalid.join(", ")}.`);
  return selected;
}

function credentialsFor(role, env) {
  const prefix = `LOAD_${role.toUpperCase()}`;
  const identifier = String(env[`${prefix}_IDENTIFIER`] || "").trim();
  const password = String(env[`${prefix}_PASSWORD`] || "");
  if (!identifier || !password) {
    throw new Error(`${prefix}_IDENTIFIER and ${prefix}_PASSWORD are required when ${role} is selected.`);
  }
  return { identifier, password };
}

function isLocalHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function parseLoadConfig(env = process.env, argv = process.argv.slice(2)) {
  const validateOnly = argv.includes("--validate") || argv.includes("--dry-run");
  const draftFlag = argv.includes("--drafts");
  const selectedRoles = roles(env.LOAD_ROLES);
  const baseUrl = new URL(env.LOAD_BASE_URL || "http://localhost:4173");
  if (!["http:", "https:"].includes(baseUrl.protocol)) {
    throw new Error("LOAD_BASE_URL must use http or https.");
  }
  baseUrl.pathname = "/";
  baseUrl.search = "";
  baseUrl.hash = "";

  const draftEnabled = draftFlag || boolean(env.LOAD_DRAFT_SCENARIO);
  const draftRole = String(env.LOAD_DRAFT_ROLE || (selectedRoles.includes("office") ? "office" : "admin"))
    .trim()
    .toLowerCase();
  if (draftEnabled && !["office", "admin"].includes(draftRole)) {
    throw new Error("LOAD_DRAFT_ROLE must be office or admin.");
  }
  if (draftEnabled && !selectedRoles.includes(draftRole)) {
    throw new Error(`LOAD_DRAFT_ROLE ${draftRole} must also be present in LOAD_ROLES.`);
  }
  if (draftEnabled && !boolean(env.LOAD_ENABLE_DRAFT_WRITES)) {
    throw new Error("Disposable draft writes require LOAD_ENABLE_DRAFT_WRITES=true.");
  }
  if (
    draftEnabled
    && !isLocalHostname(baseUrl.hostname)
    && env.LOAD_CONFIRM_REMOTE_WRITES !== "DISPOSABLE_DRAFTS"
  ) {
    throw new Error(
      "Remote disposable writes require LOAD_CONFIRM_REMOTE_WRITES=DISPOSABLE_DRAFTS.",
    );
  }

  const config = {
    validateOnly,
    baseUrl,
    roles: selectedRoles,
    credentials: Object.fromEntries(
      selectedRoles.map((role) => [role, credentialsFor(role, env)]),
    ),
    durationMs: integer(env.LOAD_DURATION_SECONDS, 30, "LOAD_DURATION_SECONDS", { min: 1, max: 3600 }) * 1000,
    warmupMs: integer(env.LOAD_WARMUP_SECONDS, 5, "LOAD_WARMUP_SECONDS", { min: 0, max: 300 }) * 1000,
    concurrencyPerRole: integer(
      env.LOAD_CONCURRENCY_PER_ROLE,
      2,
      "LOAD_CONCURRENCY_PER_ROLE",
      { min: 1, max: 100 },
    ),
    requestTimeoutMs: integer(
      env.LOAD_REQUEST_TIMEOUT_MS,
      5000,
      "LOAD_REQUEST_TIMEOUT_MS",
      { min: 100, max: 120000 },
    ),
    thresholds: {
      p95Ms: number(env.LOAD_MAX_P95_MS, 750, "LOAD_MAX_P95_MS", { min: 1 }),
      p99Ms: number(env.LOAD_MAX_P99_MS, 1500, "LOAD_MAX_P99_MS", { min: 1 }),
      errorRate: number(env.LOAD_MAX_ERROR_RATE, 0.01, "LOAD_MAX_ERROR_RATE", { min: 0, max: 1 }),
      minRequestsPerSecond: number(
        env.LOAD_MIN_REQUESTS_PER_SECOND,
        1,
        "LOAD_MIN_REQUESTS_PER_SECOND",
        { min: 0 },
      ),
      endpointP95Ms: endpointBudgets(number(
        env.LOAD_ENDPOINT_BUDGET_SCALE,
        1,
        "LOAD_ENDPOINT_BUDGET_SCALE",
        { min: 0.1, max: 10 },
      )),
    },
    reportPath: String(env.LOAD_REPORT_PATH || ".tmp/performance/http-baseline.json").trim(),
    draft: {
      enabled: draftEnabled,
      role: draftRole,
      concurrency: integer(
        env.LOAD_DRAFT_CONCURRENCY,
        5,
        "LOAD_DRAFT_CONCURRENCY",
        { min: 2, max: 10 },
      ),
      staleAfterMs: integer(
        env.LOAD_DRAFT_STALE_MINUTES,
        30,
        "LOAD_DRAFT_STALE_MINUTES",
        { min: 5, max: 10080 },
      ) * 60 * 1000,
    },
  };

  if (config.thresholds.p99Ms < config.thresholds.p95Ms) {
    throw new Error("LOAD_MAX_P99_MS must be greater than or equal to LOAD_MAX_P95_MS.");
  }
  return config;
}

export function publicConfig(config) {
  return {
    baseUrl: config.baseUrl.origin,
    roles: config.roles.map((role) => ({ role, credentialsConfigured: true })),
    durationSeconds: config.durationMs / 1000,
    warmupSeconds: config.warmupMs / 1000,
    concurrencyPerRole: config.concurrencyPerRole,
    totalReadConcurrency: config.concurrencyPerRole * config.roles.length,
    requestTimeoutMs: config.requestTimeoutMs,
    thresholds: config.thresholds,
    reportPath: config.reportPath,
    draftScenario: {
      enabled: config.draft.enabled,
      role: config.draft.role,
      concurrency: config.draft.concurrency,
    },
  };
}

export { ROLE_NAMES };
