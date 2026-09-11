import { getUnitDefinition, MAX_QUANTITY, quantityStep } from "../../../../shared/units-of-measure.js";

const measuredCategories = new Set(["liquid_volume", "mass", "gas_volume", "length"]);

export function partStockTracking(part = {}) {
  const category = getUnitDefinition(part.canonicalUomCode || part.uomCode)?.category;
  if (category === "time") return "unsupported";
  if (part.trackingMode === "quantity") return ["count", "packaging"].includes(category) ? "quantity" : "unsupported";
  if (part.trackingMode === "measured_bulk") return measuredCategories.has(category) ? "measured_bulk" : "unsupported";
  if (part.trackingMode === "serialized") return ["count", "packaging"].includes(category) ? "serialized" : "unsupported";
  // Legacy measured stock and exact-unit lineage keep their existing usage path.
  // An unreviewed count-based catalog part must not become serialized by default.
  if (measuredCategories.has(category)) return "measured_bulk";
  return part.inventory?.serializationRequired ? "serialized" : "unreviewed";
}

export function stockIntakeQuantity(value, part = {}) {
  const uomCode = part.canonicalUomCode || part.uomCode;
  const definition = getUnitDefinition(uomCode);
  const quantity = Number(value);
  const scale = definition?.decimalScale ?? 0;
  const valid = Boolean(definition) && String(value).trim() !== "" && Number.isFinite(quantity)
    && quantity > 0 && quantity <= MAX_QUANTITY
    && quantity === Number(quantity.toFixed(scale));
  return { quantity, valid, uomCode, step: quantityStep(uomCode), max: MAX_QUANTITY };
}

const pending = new Map();
function sessionStorageOrNull() {
  try { return globalThis.sessionStorage; } catch { return null; }
}
export function stockIntakeRequestKey(identity, storage = sessionStorageOrNull()) {
  const name = `stock-intake:${identity}`;
  if (pending.has(name)) return pending.get(name);
  let key;
  try { key = storage?.getItem(name); } catch { /* private storage may be unavailable */ }
  key ||= crypto.randomUUID();
  pending.set(name, key);
  try { storage?.setItem(name, key); } catch { /* memory retains retries */ }
  return key;
}

export function clearStockIntakeRequestKey(identity, storage = sessionStorageOrNull()) {
  const name = `stock-intake:${identity}`;
  pending.delete(name);
  try { storage?.removeItem(name); } catch { /* storage is optional */ }
}
