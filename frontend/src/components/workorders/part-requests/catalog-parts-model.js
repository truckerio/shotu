import { normalizeUomCode } from "../../../../../shared/units-of-measure.js";

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeInventory(raw = {}) {
  const available = numberOrZero(
    raw.available ?? raw.quantityAvailable ?? raw.availableQuantity ?? raw.qtyAvailable,
  );
  return {
    itemId: raw.itemId || raw.inventoryItemId || raw.id || "",
    locationId: raw.locationId || "",
    locationName: raw.locationName || raw.location?.name || "",
    binLocation: raw.binLocation || raw.bin || "",
    available,
    uomCode: normalizeUomCode(raw.uomCode || raw.unit || raw.unitCode),
  };
}

export function normalizeCatalogPart(raw = {}) {
  const inventorySource = Array.isArray(raw.inventory)
    ? raw.inventory.find((item) => numberOrZero(item?.available ?? item?.quantityAvailable) > 0)
      || raw.inventory[0]
      || {}
    : raw.inventory || {};

  return {
    id: raw.id || raw.catalogPartId || "",
    partNumber: String(raw.partNumber || raw.normalizedPartNumber || raw.sku || ""),
    manufacturer: String(raw.manufacturer || raw.brand || ""),
    description: String(raw.description || raw.name || ""),
    category: String(raw.category || ""),
    barcode: String(raw.barcode || ""),
    uomCode: normalizeUomCode(raw.uomCode || raw.unit || raw.unitCode),
    repairOrder: String(raw.repairOrder || raw.repairOrderTemplate || ""),
    source: String(raw.source || "company_catalog"),
    matchType: String(raw.matchType || ""),
    inventory: normalizeInventory(inventorySource),
  };
}

export function normalizeCatalogResponse(payload = {}) {
  const source = Array.isArray(payload) ? payload : payload.items || payload.results || [];
  const items = source.map(normalizeCatalogPart).filter((item) => item.id && item.partNumber);
  return {
    catalogAvailable: payload.catalogAvailable !== false && payload.catalogEmpty !== true,
    items,
  };
}

export function catalogPartDetails(part) {
  return [part.manufacturer, part.description].filter(Boolean).join(" · ") || "Company catalog part";
}

export function catalogInventoryText(part) {
  const inventory = part.inventory;
  if (!inventory?.available) {
    return "Catalog match · No available stock at this location";
  }
  const location = inventory.locationName ? ` at ${inventory.locationName}` : "";
  const bin = inventory.binLocation ? ` · Bin ${inventory.binLocation}` : "";
  return `${inventory.available} ${inventory.uomCode || part.uomCode} available${location}${bin}`;
}
