function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function normalizeConfidence(value) {
  if (typeof value === "number") {
    if (value >= 0.75) return "high";
    if (value >= 0.4) return "medium";
    return "low";
  }
  const confidence = String(value || "").trim().toLowerCase();
  return ["confirmed", "context", "high", "medium", "low"].includes(confidence) ? confidence : "";
}

function normalizeExample(raw = {}) {
  return {
    workorderId: String(raw.workorderId || raw.id || ""),
    workorderSerial: String(raw.workorderSerial || raw.workorderNumber || raw.serial || ""),
    reference: String(raw.reference || raw.workorderSerial || raw.workorderNumber || ""),
    assetId: String(raw.assetId || ""),
    unitNo: String(raw.unitNo || raw.unitNumber || ""),
    usedAt: String(raw.usedAt || raw.completedAt || raw.date || ""),
    source: String(raw.source || ""),
  };
}

export function normalizeRepairSuggestion(raw = {}, index = 0) {
  const text = String(raw.text || raw.repairOrder || raw.workPerformed || raw.description || "").trim();
  const examples = Array.isArray(raw.examples) ? raw.examples.map(normalizeExample) : [];
  return {
    id: String(raw.id || `${index}-${text}`),
    text,
    usageCount: nonNegativeInteger(raw.usageCount ?? raw.count ?? raw.uses),
    latestUsedAt: String(raw.latestUsedAt || raw.lastUsedAt || raw.usedAt || ""),
    confidence: normalizeConfidence(raw.confidence),
    source: String(raw.source || "service_history"),
    sameAsset: Boolean(raw.sameAsset),
    context: String(raw.context || raw.contextLabel || ""),
    examples,
  };
}

export function normalizeRepairSuggestionsResponse(payload = {}) {
  const source = Array.isArray(payload) ? payload : payload.suggestions || payload.items || [];
  const seen = new Set();
  const suggestions = [];
  for (const [index, raw] of source.entries()) {
    const suggestion = normalizeRepairSuggestion(raw, index);
    const key = suggestion.text.toLocaleLowerCase();
    if (!suggestion.text || seen.has(key)) continue;
    seen.add(key);
    suggestions.push(suggestion);
    if (suggestions.length >= 5) break;
  }
  return suggestions;
}

export function repairSuggestionMeta(suggestion, currentAssetId = "") {
  const parts = [];
  if (suggestion.usageCount) {
    parts.push(`Used ${suggestion.usageCount} ${suggestion.usageCount === 1 ? "time" : "times"}`);
  }
  if (suggestion.confidence === "confirmed") parts.push("Confirmed link");
  else if (suggestion.confidence === "context") parts.push("Same service order");
  else if (suggestion.confidence) parts.push(`${suggestion.confidence} confidence`);
  if (suggestion.context) parts.push(suggestion.context);
  else if (suggestion.sameAsset
    || (currentAssetId && suggestion.examples.some((example) => example.assetId === currentAssetId))) parts.push("Same unit");
  else if (suggestion.examples[0]?.unitNo) parts.push(`Unit ${suggestion.examples[0].unitNo}`);
  else if (suggestion.examples[0]?.reference) parts.push(suggestion.examples[0].reference);
  else if (suggestion.source === "odoo") parts.push("Odoo service history");
  return parts.join(" · ") || "From service history";
}
