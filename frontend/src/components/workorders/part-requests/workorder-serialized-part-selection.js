export function isEligibleSerializedUnit(unit) {
  return unit.eligible !== false && unit.eligibility?.canIssue !== false && unit.canIssue !== false;
}

export function eligibleSelectedUnitIds(units, selectedUnitIds) {
  return units.filter((unit) => selectedUnitIds.has(unit.id) && isEligibleSerializedUnit(unit)).map((unit) => unit.id);
}

export function selectAllEligibleUnitIds(units) {
  return new Set(units.filter(isEligibleSerializedUnit).map((unit) => unit.id));
}

export const PART_PRICE_SOURCES = [
  { value: "batch_cost", label: "Batch cost" },
  { value: "internal_cost", label: "Internal price" },
  { value: "selling_price", label: "Selling price" },
];

export function knownPriceOption(options, selection) {
  const option = options?.[selection];
  const rawAmount = option?.price?.totalPrice ?? option?.price?.unitPrice;
  const currency = String(option?.price?.currency || "").trim();
  return option?.status === "known" && rawAmount != null && Number.isFinite(Number(rawAmount)) && currency ? option : null;
}

export function missingPriceLabel(selection) {
  return selection === "batch_cost" ? "Cost not recorded" : "Not configured";
}

export function formatPriceAmount(price, locale = "en") {
  const rawAmount = price?.totalPrice ?? price?.unitPrice;
  const currency = String(price?.currency || "").trim().toUpperCase();
  const amount = Number(rawAmount);
  if (rawAmount == null || !currency || !Number.isFinite(amount)) return "Missing price";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 4,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(4).replace(/\.?0+$/, "")}`;
  }
}

function optionCurrency(option) {
  return String(option?.price?.currency || "").trim().toUpperCase();
}

export function serializedPricingSelection(previewsByUnitId, unitIds, selection) {
  const selectedIds = Array.from(unitIds || []);
  if (!selectedIds.length || !selection) return null;
  const units = [];
  for (const unitId of selectedIds) {
    const preview = previewsByUnitId?.[unitId];
    const option = knownPriceOption(preview?.options, selection);
    if (!preview?.fingerprint || !option) return null;
    units.push({ unitId, fingerprint: preview.fingerprint, option });
  }
  if (new Set(units.map(({ option }) => optionCurrency(option))).size !== 1 || !optionCurrency(units[0]?.option)) return null;
  return units;
}

export function serializedPriceSourceOptions(previewsByUnitId, unitIds, locale = "en") {
  const ids = Array.from(unitIds || []);
  return PART_PRICE_SOURCES.map((source) => {
    const entries = ids.map((unitId) => previewsByUnitId?.[unitId]).filter(Boolean);
    const knownEntries = entries.map((entry) => knownPriceOption(entry.options, source.value));
    const currencies = new Set(knownEntries.filter(Boolean).map(optionCurrency));
    const mixedCurrencies = currencies.size > 1;
    const known = ids.length > 0
      && entries.length === ids.length
      && knownEntries.every(Boolean)
      && currencies.size === 1
      && !currencies.has("");
    const total = known
      ? entries.reduce((sum, entry) => sum + Number(knownPriceOption(entry.options, source.value).price.totalPrice ?? knownPriceOption(entry.options, source.value).price.unitPrice), 0)
      : null;
    const currency = known ? knownPriceOption(entries[0]?.options, source.value)?.price?.currency : "USD";
    return {
      ...source,
      amount: known
        ? formatPriceAmount({ totalPrice: total, currency }, locale)
        : mixedCurrencies ? "Mixed currencies" : ids.length ? missingPriceLabel(source.value) : "Select a serial number",
      disabled: !known,
    };
  });
}

/**
 * Issues the current selection one serialized unit at a time. The caller owns
 * the key map so a failed unit retries with its original idempotency key.
 */
export async function issueSelectedSerializedUnits({
  units,
  selectedUnitIds,
  keyByUnitId,
  createKey,
  issue,
  onIssued,
}) {
  const successes = [];
  const failures = [];
  const selectedIds = eligibleSelectedUnitIds(units, selectedUnitIds);

  for (const unitId of selectedIds) {
    if (!keyByUnitId.has(unitId)) keyByUnitId.set(unitId, createKey(unitId));
    try {
      const result = await issue(unitId, keyByUnitId.get(unitId));
      await onIssued?.(result, unitId);
      successes.push(unitId);
    } catch (error) {
      failures.push({ id: unitId, error });
    }
  }

  return { successes, failures };
}
