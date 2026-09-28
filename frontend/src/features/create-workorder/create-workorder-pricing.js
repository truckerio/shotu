const PART_SELECTIONS = new Set(["batch_cost", "selling_price"]);
const LABOR_SELECTIONS = new Set(["internal_cost", "selling_price"]);

function customUnitPrice(value) {
  const price = String(value ?? "").trim();
  return /^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/.test(price) ? price : "";
}

function hasInvalidCustomPrice(payload) {
  const values = [
    ...(Array.isArray(payload?.pricing?.parts) ? payload.pricing.parts.map((entry) => entry?.customUnitPrice) : []),
    payload?.pricing?.labor?.customUnitPrice,
  ];
  return values.some((value) => String(value ?? "").trim() && !customUnitPrice(value));
}

export function createPricingPreferences(payload) {
  const parts = (Array.isArray(payload?.pricing?.parts) ? payload.pricing.parts : [])
    .filter((entry) => Number.isInteger(entry?.partIndex) && PART_SELECTIONS.has(entry?.selection))
    .map(({ partIndex, selection, customUnitPrice: custom }) => ({
      partIndex,
      selection,
      ...(customUnitPrice(custom) ? { customUnitPrice: customUnitPrice(custom) } : {}),
    }));
  const laborSelection = payload?.pricing?.labor?.selection;
  const laborCustomUnitPrice = customUnitPrice(payload?.pricing?.labor?.customUnitPrice);
  return {
    parts,
    ...(LABOR_SELECTIONS.has(laborSelection) ? {
      labor: {
        selection: laborSelection,
        ...(laborCustomUnitPrice ? { customUnitPrice: laborCustomUnitPrice } : {}),
      },
    } : {}),
  };
}

export function createPricingPreviewRequest(payload) {
  return {
    ...payload,
    pricing: createPricingPreferences(payload),
  };
}

export function createPricingRequirements(payload) {
  const partIndexes = [...new Set([
    ...(payload?.inventoryUnitSelections || []).map((entry) => entry?.partIndex),
    ...(payload?.inventoryPositionSelections || []).map((entry) => entry?.partIndex),
  ].filter(Number.isInteger))].sort((left, right) => left - right);
  const labor = Number(payload?.formData?.laborHours) > 0;
  return { partIndexes, labor, hasPriceableRows: labor || partIndexes.length > 0 };
}

export function createPricingRequestKey(payload) {
  const request = createPricingPreviewRequest(payload);
  return JSON.stringify({
    companyId: request.companyId || "",
    locationId: request.locationId || "",
    inventoryUnitSelections: request.inventoryUnitSelections || [],
    inventoryPositionSelections: request.inventoryPositionSelections || [],
    laborHours: request.formData?.laborHours || "",
    laborProduct: request.formData?.laborProduct || null,
    parts: (request.formData?.parts || []).map((part) => ({
      catalogPartId: part.catalogPartId || null,
      partNo: part.partNo || "",
      qty: part.qty || "",
      uomCode: part.uomCode || "",
      sourcePositionId: part.sourcePositionId || null,
      serializedUnitIds: part.serializedUnitIds || [],
      purchaseRequested: part.purchaseRequested === true,
    })),
    pricing: request.pricing,
  });
}

export function createPricingSubmitPayload(payload, fingerprint) {
  if (hasInvalidCustomPrice(payload)) return null;
  const pricing = createPricingPreferences(payload);
  if (!fingerprint || (!pricing.parts.length && !pricing.labor)) return null;
  return { ...pricing, expectedFingerprint: fingerprint };
}

export function normalizeCreatePricingPreview(result) {
  return {
    fingerprint: typeof result?.fingerprint === "string" ? result.fingerprint : "",
    parts: Array.isArray(result?.parts) ? result.parts : [],
    labor: result?.labor && typeof result.labor === "object" ? result.labor : null,
    summary: result?.summary && typeof result.summary === "object"
      ? result.summary
      : { status: "incomplete", missingCount: 0 },
  };
}

export function selectedPricingIsComplete(payload, preview) {
  if (hasInvalidCustomPrice(payload)) return false;
  const preferences = createPricingPreferences(payload);
  const requirements = createPricingRequirements(payload);
  if (!requirements.hasPriceableRows) return true;
  if (!preview?.fingerprint) return false;
  const selectedByIndex = new Map(preferences.parts.map((entry) => [entry.partIndex, entry]));
  const byIndex = new Map(preview.parts.map((entry) => [entry.partIndex, entry]));
  if (requirements.partIndexes.some((partIndex) => !selectedByIndex.has(partIndex)
    || byIndex.get(partIndex)?.status !== "known")) return false;
  return !requirements.labor || Boolean(preferences.labor) && preview.labor?.status === "known";
}
