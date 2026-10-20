export const RATE_KINDS = ["internal_cost", "selling_price"];

export function availableRateKinds(allowedKinds) {
  const requested = Array.isArray(allowedKinds) ? allowedKinds : RATE_KINDS;
  return RATE_KINDS.filter((kind) => requested.includes(kind));
}

export function rateDraft(rates, kind) {
  const rate = rates?.[kind] || {};
  return {
    amount: rate.amount ?? "",
    currency: rate.currency || "USD",
    method: kind === "selling_price" ? rate.method || "fixed" : "fixed",
  };
}

export function sellingRateDraft(policy, trackingMode, fallbackCurrency = "USD") {
  const fixedRequired = trackingMode === "no_stock";
  const incompatible = fixedRequired && policy?.method && policy.method !== "fixed";
  return {
    amount: incompatible ? "" : policy?.value ?? "",
    currency: policy?.currency || fallbackCurrency || "USD",
    method: fixedRequired ? "fixed" : policy?.method || "fixed",
  };
}

export function rateDraftIsValid({ kind, amount, currency, reason, method }) {
  const numeric = /^\d{1,10}(?:\.\d{1,4})?$/.test(String(amount).trim());
  if (kind === "internal_cost" && String(amount).trim() === "") {
    return Boolean(currency) && String(reason).trim().length >= 2;
  }
  return numeric
    && (method === "markup_percent" || Boolean(currency))
    && String(reason).trim().length >= 2;
}

export function rateSourceLabel(source, locationScoped) {
  if (source === "location_override") return "Location override";
  if (source === "company_default" && locationScoped) return "Company fallback";
  if (source === "company_default") return "Company default";
  return "Not configured";
}

export function editablePartRateKinds({ readOnly, commercialCapabilities, sellingCapabilities }) {
  if (readOnly) return [];
  return [
    commercialCapabilities?.canEditPrices === true && "internal_cost",
    sellingCapabilities?.canEdit === true && "selling_price",
  ].filter(Boolean);
}

export function partRatePaths(catalogPartId, locationId) {
  const base = `/api/office/inventory/parts/${encodeURIComponent(catalogPartId)}`;
  const query = locationId ? `?${new URLSearchParams({ locationId })}` : "";
  return {
    commercial: `${base}/commercial?${new URLSearchParams({ limit: "50", ...(locationId ? { locationId } : {}) })}`,
    internal: locationId ? `${base}/locations/${encodeURIComponent(locationId)}/prices/internal` : `${base}/prices/internal`,
    selling: `${base}/selling-policy${query}`,
  };
}

export function retryCommand(previous, signature, createKey) {
  return previous?.signature === signature ? previous : { signature, key: createKey() };
}

export async function notifyRateSaved(onSaved) {
  try {
    await onSaved?.();
    return true;
  } catch {
    return false;
  }
}
