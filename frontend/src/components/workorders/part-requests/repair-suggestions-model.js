import { formatLocaleNumber, interfaceText } from "../../../i18n/index.js";

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

export function repairSuggestionMeta(suggestion, currentAssetId = "", locale = "en") {
  const t = (key) => interfaceText(locale, key);
  const parts = [];
  if (suggestion.usageCount) {
    parts.push(`${t("parts.used")} ${formatLocaleNumber(suggestion.usageCount, locale)} ${t(suggestion.usageCount === 1 ? "parts.time" : "parts.times")}`);
  }
  if (suggestion.confidence === "confirmed") parts.push(t("parts.confirmedLink"));
  else if (suggestion.confidence === "context") parts.push(t("parts.sameServiceOrder"));
  else if (suggestion.confidence) parts.push(t(`parts.confidence.${suggestion.confidence}`));
  if (suggestion.context) parts.push(suggestion.context);
  else if (suggestion.sameAsset
    || (currentAssetId && suggestion.examples.some((example) => example.assetId === currentAssetId))) parts.push(t("parts.sameUnit"));
  else if (suggestion.examples[0]?.unitNo) parts.push(`${t("parts.unit")} ${suggestion.examples[0].unitNo}`);
  else if (suggestion.examples[0]?.reference) parts.push(suggestion.examples[0].reference);
  else if (suggestion.source === "odoo") parts.push(t("parts.odooServiceHistory"));
  return parts.join(" · ") || t("parts.fromServiceHistory");
}
