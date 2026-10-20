import { independentSerializedPartRows } from "../workorder-modules/parts/create-parts-model.js";

const PART_SELECTIONS = new Set(["batch_cost", "internal_cost", "selling_price"]);
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
    .filter((entry) => Number.isInteger(entry?.partIndex) && PART_SELECTIONS.has(entry?.selection)
      && (payload?.formData?.parts?.[entry.partIndex]?.trackingMode === "no_stock"
        ? entry.selection !== "batch_cost" : true))
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
    ...(payload?.formData?.parts || []).flatMap((part, partIndex) => part?.catalogPartId && part.trackingMode === "no_stock" && part.purchaseRequested !== true ? [partIndex] : []),
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
      trackingMode: part.trackingMode || null,
      noStockLineId: part.noStockLineId || null,
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

// Isolate a draft picker selection without sending editable/client price amounts.
export function createPartSelectionPreviewRequest(payload, part, patch) {
  const selected = independentSerializedPartRows([{ ...part, ...patch }]);
  const parts = selected.map((row) => ({ catalogPartId: row.catalogPartId, partNo: row.partNo,
    qty: row.qty, uomCode: row.uomCode, trackingMode: row.trackingMode,
    ...(row.serializationRequired ? { serializationRequired: true } : {}) }));
  return {
    ...createPricingPreviewRequest(payload),
    formData: { ...payload.formData, parts, laborHours: "" },
    inventoryUnitSelections: selected.flatMap((row, partIndex) => row.serializedUnitIds?.length
      ? [{ partIndex, catalogPartId: row.catalogPartId, unitIds: row.serializedUnitIds }] : []),
    inventoryPositionSelections: selected.flatMap((row, partIndex) => row.sourcePositionId
      ? [{ partIndex, catalogPartId: row.catalogPartId, positionId: row.sourcePositionId }] : []),
    pricing: { parts: [] },
  };
}

function priceScaled(value) {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(String(value));
  if (!match) throw new Error("Invalid price preview.");
  return BigInt(match[1]) * 10000n + BigInt((match[2] || "").padEnd(4, "0"));
}
function priceFixed(value) { return `${value / 10000n}.${(value % 10000n).toString().padStart(4, "0")}`; }

export function combinePartSelectionPreview(result) {
  const parts = Array.isArray(result?.parts) ? result.parts : [];
  if (parts.length === 1) return { ...parts[0], fingerprint: result.fingerprint };
  const options = Object.fromEntries(["batch_cost", "internal_cost", "selling_price"].map((kind) => {
    const candidates = parts.map((row) => row.options?.[kind]);
    const prices = candidates.map((option) => option?.price);
    if (!parts.length || candidates.some((option) => option?.status !== "known") || new Set(prices.map((price) => price?.currency)).size !== 1) {
      return [kind, { status: "incomplete", price: null, reason: "Price unavailable or currencies differ across selected units." }];
    }
    try {
      const total = prices.reduce((sum, price) => sum + priceScaled(price.totalPrice), 0n);
      const count = BigInt(parts.length);
      return [kind, { status: "known", price: { selection: kind, currency: prices[0].currency,
        unitPrice: priceFixed((total + count / 2n) / count), totalPrice: priceFixed(total), quantity: String(parts.length) } }];
    } catch { return [kind, { status: "incomplete", price: null, reason: "Exact prices unavailable." }]; }
  }));
  return { fingerprint: result?.fingerprint || "", options, parts };
}
