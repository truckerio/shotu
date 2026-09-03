import { buildQaAccountManifest } from "../account-manifest.js";
import { assertQaTargetSafety } from "../safety.js";

export const INSPECTION_REMOTE_WRITE_CONFIRMATION = "RUN_INSPECTION_WORKFLOW";
export const INSPECTION_EVIDENCE_RETENTION_ACKNOWLEDGEMENT = "RETAIN_QA_INSPECTION_EVIDENCE";
export const INSPECTION_REQUIRED_CAPABILITIES = Object.freeze([
  "follow_up",
  "correction",
  "reinspection",
]);

function bool(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return new Set(["1", "true", "yes", "on"]).has(String(value).trim().toLowerCase());
}

function required(environment, key) {
  const value = String(environment[key] || "").trim();
  if (!value) throw new Error(`${key} is required for the inspection workflow fixture.`);
  return value;
}

export function parseInspectionWorkflowConfig(environment = process.env, argv = process.argv.slice(2)) {
  const target = String(environment.QA_INSPECTION_TARGET_ENVIRONMENT || environment.QA_E2E_TARGET_ENVIRONMENT || "").trim();
  const safety = assertQaTargetSafety({ environment, options: { target } });
  if (safety.production) throw new Error("The inspection workflow cannot run against production.");
  const baseUrl = new URL(environment.QA_INSPECTION_BASE_URL || environment.QA_E2E_BASE_URL || "http://localhost:4173");
  if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error("QA_INSPECTION_BASE_URL must use http or https.");
  const remote = !["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname);
  if (remote && environment.QA_INSPECTION_CONFIRM_REMOTE_WRITES !== INSPECTION_REMOTE_WRITE_CONFIRMATION) {
    throw new Error(`Remote staging writes require QA_INSPECTION_CONFIRM_REMOTE_WRITES=${INSPECTION_REMOTE_WRITE_CONFIRMATION}.`);
  }
  if (remote && environment.QA_INSPECTION_EVIDENCE_RETENTION_ACKNOWLEDGEMENT !== INSPECTION_EVIDENCE_RETENTION_ACKNOWLEDGEMENT) {
    throw new Error(`Remote inspection evidence requires QA_INSPECTION_EVIDENCE_RETENTION_ACKNOWLEDGEMENT=${INSPECTION_EVIDENCE_RETENTION_ACKNOWLEDGEMENT}.`);
  }
  const password = String(environment.QA_ACCOUNT_PASSWORD || "");
  if (password.length < 12 || password.length > 128 || /[\r\n]/.test(password)) throw new Error("QA_ACCOUNT_PASSWORD must contain 12-128 characters without line breaks.");
  const namespace = String(environment.QA_ACCOUNT_NAMESPACE || "qa").trim();
  const accounts = Object.fromEntries(buildQaAccountManifest(namespace).map((account) => [account.role, { ...account, password }]));
  const capabilities = String(environment.QA_INSPECTION_CAPABILITIES || INSPECTION_REQUIRED_CAPABILITIES.join(","))
    .split(",").map((value) => value.trim()).filter(Boolean);
  const missingCapabilities = INSPECTION_REQUIRED_CAPABILITIES.filter((capability) => !capabilities.includes(capability));
  if (missingCapabilities.length) throw new Error(`Inspection workflow cannot silently skip required capabilities: ${missingCapabilities.join(", ")}.`);
  return {
    target: safety.target, databaseHost: safety.databaseHost, baseUrl, namespace, password, accounts,
    companySlug: String(environment.QA_COMPANY_SLUG || "default").trim(),
    locationName: required(environment, "QA_LOCATION_NAME"), evidenceNamespace: remote ? required(environment, "QA_INSPECTION_EVIDENCE_NAMESPACE") : "local",
    fixtures: { truckAssetId: required(environment, "QA_INSPECTION_TRUCK_ASSET_ID"), trailerAssetId: required(environment, "QA_INSPECTION_TRAILER_ASSET_ID") },
    browser: { enabled: !argv.includes("--api-only") && bool(environment.QA_INSPECTION_API_ONLY, false) === false, channel: String(environment.QA_E2E_BROWSER_CHANNEL || "chrome"), headless: bool(environment.QA_E2E_HEADLESS, true) },
    requestTimeoutMs: Number(environment.QA_E2E_REQUEST_TIMEOUT_MS || 10_000),
    capabilities,
  };
}

export function publicInspectionWorkflowConfig(config) {
  return { target: config.target, databaseHost: config.databaseHost, baseUrl: config.baseUrl.origin, namespace: config.namespace, companySlug: config.companySlug, locationName: config.locationName, evidenceNamespace: config.evidenceNamespace, fixtures: { truck: "configured", trailer: "configured" }, browser: config.browser, capabilities: config.capabilities, credentials: Object.values(config.accounts).map(({ role, username }) => ({ role, identifier: username, configured: true })) };
}
