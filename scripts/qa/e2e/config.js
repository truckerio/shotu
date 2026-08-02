import { buildQaAccountManifest } from "../account-manifest.js";
import { assertQaTargetSafety } from "../safety.js";

const REMOTE_WRITE_CONFIRMATION = "RUN_ROLE_WORKFLOW";
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function boolean(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return TRUE_VALUES.has(String(value).trim().toLowerCase());
}

function positiveInteger(value, fallback, name) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 120_000) {
    throw new Error(`${name} must be an integer between 100 and 120000.`);
  }
  return parsed;
}

function isLocalHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function parseRoleWorkflowConfig(environment = process.env, argv = process.argv.slice(2)) {
  const target = String(environment.QA_E2E_TARGET_ENVIRONMENT || environment.QA_TARGET_ENVIRONMENT || "").trim();
  const safety = assertQaTargetSafety({ environment, options: { target } });
  if (safety.production) {
    throw new Error("The role workflow test cannot run against production. Use an isolated local or staging database.");
  }

  const baseUrl = new URL(environment.QA_E2E_BASE_URL || "http://localhost:4173");
  if (!["http:", "https:"].includes(baseUrl.protocol)) {
    throw new Error("QA_E2E_BASE_URL must use http or https.");
  }
  baseUrl.pathname = "/";
  baseUrl.search = "";
  baseUrl.hash = "";

  if (
    !isLocalHostname(baseUrl.hostname)
    && environment.QA_E2E_CONFIRM_REMOTE_WRITES !== REMOTE_WRITE_CONFIRMATION
  ) {
    throw new Error(`Remote staging writes require QA_E2E_CONFIRM_REMOTE_WRITES=${REMOTE_WRITE_CONFIRMATION}.`);
  }

  const password = String(environment.QA_ACCOUNT_PASSWORD || "");
  if (password.length < 12 || password.length > 128 || /[\r\n]/.test(password)) {
    throw new Error("QA_ACCOUNT_PASSWORD must contain 12-128 characters without line breaks.");
  }

  const namespace = String(environment.QA_ACCOUNT_NAMESPACE || "qa").trim();
  const accounts = Object.fromEntries(buildQaAccountManifest(namespace).map((account) => [
    account.role,
    { ...account, password },
  ]));
  const apiOnly = argv.includes("--api-only") || boolean(environment.QA_E2E_API_ONLY, false);

  const locationName = String(environment.QA_LOCATION_NAME || "").trim();
  if (!locationName) throw new Error("QA_LOCATION_NAME is required.");

  return {
    target: safety.target,
    databaseHost: safety.databaseHost,
    baseUrl,
    companySlug: String(environment.QA_COMPANY_SLUG || "default").trim(),
    locationName,
    namespace,
    password,
    accounts,
    provisionAccounts: !argv.includes("--no-provision")
      && boolean(environment.QA_E2E_PROVISION_ACCOUNTS, true),
    browser: {
      enabled: !apiOnly,
      channel: String(environment.QA_E2E_BROWSER_CHANNEL || "chrome").trim(),
      headless: boolean(environment.QA_E2E_HEADLESS, true),
    },
    requestTimeoutMs: positiveInteger(
      environment.QA_E2E_REQUEST_TIMEOUT_MS,
      10_000,
      "QA_E2E_REQUEST_TIMEOUT_MS",
    ),
  };
}

export function publicRoleWorkflowConfig(config) {
  return {
    target: config.target,
    databaseHost: config.databaseHost,
    baseUrl: config.baseUrl.origin,
    companySlug: config.companySlug,
    locationName: config.locationName,
    namespace: config.namespace,
    provisionAccounts: config.provisionAccounts,
    browser: config.browser,
    credentials: Object.values(config.accounts).map((account) => ({
      role: account.role,
      identifier: account.username,
      configured: true,
    })),
  };
}

export { REMOTE_WRITE_CONFIRMATION };
