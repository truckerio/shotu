const TARGETS = new Set(["local", "staging", "production"]);
const PRODUCTION_PHRASE = "PROVISION_QA_ACCOUNTS_IN_PRODUCTION";
const PRODUCTION_ENV_CONFIRMATION = "I_ACCEPT_REAL_PRODUCTION_USER_WRITES";

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

export function databaseHost(databaseUrl) {
  try {
    return new URL(String(databaseUrl || "")).hostname || "unknown";
  } catch {
    return "unknown";
  }
}

export function productionIndicators(environment = {}) {
  return [
    normalized(environment.NODE_ENV) === "production" && "NODE_ENV",
    /(^|[-_\s])prod(uction)?($|[-_\s])/i.test(String(environment.RAILWAY_ENVIRONMENT_NAME || ""))
      && "RAILWAY_ENVIRONMENT_NAME",
    normalized(environment.RAILWAY_ENVIRONMENT) === "production" && "RAILWAY_ENVIRONMENT",
    normalized(environment.QA_DATABASE_CLASSIFICATION) === "production" && "QA_DATABASE_CLASSIFICATION",
  ].filter(Boolean);
}

export function assertQaTargetSafety({ environment = process.env, options = {} } = {}) {
  const target = normalized(options.target || environment.QA_TARGET_ENVIRONMENT);
  if (!TARGETS.has(target)) {
    throw new Error("Declare QA_TARGET_ENVIRONMENT as local, staging, or production.");
  }

  const indicators = productionIndicators(environment);
  const production = target === "production" || indicators.length > 0;
  if (indicators.length > 0 && target !== "production") {
    throw new Error(`Runtime appears to be production (${indicators.join(", ")}); target must be production.`);
  }

  if (production) {
    if (options.allowProduction !== true) {
      throw new Error("Production QA-account changes require --allow-production.");
    }
    if (options.productionConfirmation !== PRODUCTION_PHRASE) {
      throw new Error(`Production QA-account changes require --confirm-production=${PRODUCTION_PHRASE}.`);
    }
    if (environment.QA_PRODUCTION_CONFIRMATION !== PRODUCTION_ENV_CONFIRMATION) {
      throw new Error(`Production QA-account changes require QA_PRODUCTION_CONFIRMATION=${PRODUCTION_ENV_CONFIRMATION}.`);
    }
    const expectedHost = databaseHost(environment.DATABASE_URL);
    if (expectedHost === "unknown" || options.confirmDatabaseHost !== expectedHost) {
      throw new Error(`Production QA-account changes require --confirm-database-host=${expectedHost}.`);
    }
  }

  return {
    target,
    production,
    databaseHost: databaseHost(environment.DATABASE_URL),
  };
}

export function redactQaError(error, secrets = []) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret) message = message.replaceAll(String(secret), "[REDACTED]");
  }
  return message;
}
export const QA_PRODUCTION_CONFIRMATION = Object.freeze({
  argument: PRODUCTION_PHRASE,
  environment: PRODUCTION_ENV_CONFIRMATION,
});
