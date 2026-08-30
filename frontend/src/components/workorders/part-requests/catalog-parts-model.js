import { normalizeUomCode } from "../../../../../shared/units-of-measure.js";

const MAX_PART_REPAIR_ORDER_LENGTH = 2000;

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

export function catalogPartDetails(part, localeText = null, purpose = "issue") {
  return [part.manufacturer, part.description].filter(Boolean).join(" · ")
    || (localeText
      ? localeText(purpose === "master_match" ? "parts.masterCatalogPart" : "parts.ourInventoryPart")
      : purpose === "master_match" ? "Master catalog part" : "Our inventory part");
}

export function repairOrderAfterCatalogSelection(currentRepairOrder, catalogPart = {}) {
  const current = String(currentRepairOrder || "");
  if (current.trim()) return current;
  return String(catalogPart.description || "").trim().slice(0, MAX_PART_REPAIR_ORDER_LENGTH);
}

export function catalogInventoryText(part, localeText = null, formatNumber = String) {
  const inventory = part.inventory;
  if (!inventory?.available) {
    return localeText
      ? `${localeText("parts.catalogMatch")} · ${localeText("parts.noAvailableAtLocation")}`
      : "Catalog match · No available stock at this location";
  }
  const location = inventory.locationName
    ? ` ${localeText ? localeText("parts.at") : "at"} ${inventory.locationName}`
    : "";
  const bin = inventory.binLocation
    ? ` · ${localeText ? localeText("parts.bin") : "Bin"} ${inventory.binLocation}`
    : "";
  return `${formatNumber(inventory.available)} ${inventory.uomCode || part.uomCode} ${localeText ? localeText("parts.available") : "available"}${location}${bin}`;
}
