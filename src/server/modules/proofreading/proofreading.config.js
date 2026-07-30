function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(parsed, maximum));
}

function enabled(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

export function resolveProofreadingConfig(environment = process.env) {
  const provider = String(environment.PROOFREADING_PROVIDER || "disabled").trim().toLowerCase();
  return {
    provider,
    cacheMaxEntries: boundedInteger(environment.PROOFREADING_CACHE_MAX_ENTRIES, 250, 1, 1_000),
    cacheTtlMs: boundedInteger(environment.PROOFREADING_CACHE_TTL_MS, 30_000, 1_000, 300_000),
    concurrencyLimit: boundedInteger(environment.PROOFREADING_CONCURRENCY_LIMIT, 4, 1, 16),
    contextMinConfidence: boundedInteger(environment.PROOFREADING_CONTEXT_MIN_CONFIDENCE, 95, 80, 100),
    contextProvider: String(environment.PROOFREADING_CONTEXT_PROVIDER || "disabled").trim().toLowerCase(),
    contextTimeoutMs: boundedInteger(environment.PROOFREADING_CONTEXT_TIMEOUT_MS, 5_000, 250, 5_000),
    deepModeEnabled: enabled(environment.PROOFREADING_DEEP_MODE_ENABLED),
    deepTimeoutMs: boundedInteger(environment.PROOFREADING_DEEP_TIMEOUT_MS, 5_000, 500, 10_000),
    lexicalRecoveryMaxChars: boundedInteger(environment.PROOFREADING_RECOVERY_MAX_CHARS, 1_200, 64, 5_000),
    openAiApiBaseUrl: String(environment.OPENAI_API_BASE_URL || "https://api.openai.com/v1").trim(),
    openAiApiKey: String(environment.OPENAI_API_KEY || "").trim(),
    openAiModel: String(environment.PROOFREADING_OPENAI_MODEL || "gpt-5.6-luna").trim(),
    wproofreaderServiceId: String(environment.WPROOFREADER_SERVICE_ID || "").trim(),
    timeoutMs: boundedInteger(environment.PROOFREADING_TIMEOUT_MS, 3_000, 250, 10_000),
  };
}
