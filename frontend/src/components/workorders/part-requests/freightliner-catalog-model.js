export const FREIGHTLINER_CATALOG_URL = "https://www.dtnaparts.com/excelerator/";

export function freightlinerAssetContext(workorder = {}) {
  const asset = workorder.asset || {};
  return {
    id: String(asset.id || workorder.assetId || ""),
    make: String(asset.make || "").trim(),
    model: String(asset.model || workorder.formData?.model || "").trim(),
    unitNo: String(asset.unitNo || asset.name || workorder.formData?.unitNo || "").trim(),
    vin: String(asset.vin || workorder.formData?.vinNo || "").trim(),
  };
}

export function isFreightlinerAsset(asset) {
  return String(asset?.make || "").trim().toLowerCase() === "freightliner";
}

// VIN position 9 is a transcription check digit under 49 CFR 565.15.
const VIN_VALUES = Object.freeze({
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
});
const VIN_WEIGHTS = Object.freeze([8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]);

export function validFreightlinerVin(vin) {
  const value = String(vin || "").trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(value)) return false;
  const sum = [...value].reduce((total, character, index) => (
    total + (Number.isNaN(Number(character)) ? VIN_VALUES[character] : Number(character)) * VIN_WEIGHTS[index]
  ), 0);
  const remainder = sum % 11;
  return value[8] === (remainder === 10 ? "X" : String(remainder));
}

export function freightlinerRequestContextKey(workorder = {}) {
  const asset = freightlinerAssetContext(workorder);
  return JSON.stringify([workorder.id || "", asset.id, asset.make, asset.model, asset.unitNo, asset.vin]);
}
