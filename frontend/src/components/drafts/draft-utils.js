function normalizeValue(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalizeValue);

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = normalizeValue(value[key]);
      return result;
    }, {});
}

export function fingerprintDraftValue(value) {
  return JSON.stringify(normalizeValue(value));
}

export function resolveMeaningful(meaningful, value) {
  return typeof meaningful === "function" ? Boolean(meaningful(value)) : Boolean(meaningful);
}

export function mergeDraftResult(currentDraft, result, fallbackPayload) {
  const nextDraft = result && typeof result === "object" ? result : {};
  return {
    ...(currentDraft || {}),
    ...nextDraft,
    payload: Object.hasOwn(nextDraft, "payload") ? nextDraft.payload : fallbackPayload,
  };
}
