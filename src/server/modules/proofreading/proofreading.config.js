function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveProofreadingConfig(environment = process.env) {
  const provider = String(environment.PROOFREADING_PROVIDER || "disabled").trim().toLowerCase();
  return {
    provider,
    wproofreaderServiceId: String(environment.WPROOFREADER_SERVICE_ID || "").trim(),
    timeoutMs: positiveInteger(environment.PROOFREADING_TIMEOUT_MS, 3_000),
  };
}
