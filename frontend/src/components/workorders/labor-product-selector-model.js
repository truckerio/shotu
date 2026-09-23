import { repairOrderAfterCatalogSelection } from "./part-requests/catalog-parts-model.js";

export function normalizeLaborProductItem(item = {}) {
  const id = String(item.id || item.productId || "").trim();
  const name = String(item.name || "").trim();
  return {
    id,
    name,
    ...(String(item.description || "").trim() ? { description: String(item.description).trim() } : {}),
    code: String(item.code || "").trim(),
    uomCode: "hr",
    pinned: Boolean(item.pinned),
    ...(item.source?.provider ? { source: { provider: String(item.source.provider), externalId: String(item.source.externalId || "") } } : {}),
    ...(item.odooPricing ? { odooPricing: {
      internal: normalizeProviderPrice(item.odooPricing.internal),
      selling: normalizeProviderPrice(item.odooPricing.selling),
      updatedAt: item.odooPricing.updatedAt || null,
    } } : {}),
  };
}

function normalizeProviderPrice(price = {}) {
  const currency = String(price.currency || "").trim().toUpperCase();
  const amount = price.amount === null || price.amount === undefined ? null : String(price.amount);
  const known = price.status === "known" && amount !== null && /^[A-Z]{3}$/.test(currency);
  return { status: known ? "known" : "unknown", amount: known ? amount : null, currency: known ? currency : null };
}

export function laborProviderPriceLabel(item = {}) {
  const price = item.odooPricing?.selling;
  if (price?.status !== "known") return "";
  try { return `Odoo selling ${new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency, maximumFractionDigits: 4 }).format(Number(price.amount))} / hr`; }
  catch { return `Odoo selling ${price.currency} ${price.amount} / hr`; }
}

export function normalizeLaborProductsResponse(payload = {}) {
  return {
    items: Array.isArray(payload.items)
      ? payload.items.map(normalizeLaborProductItem).filter((item) => item.id && item.name)
      : [],
    canCreate: Boolean(payload.canCreate),
    canPin: Boolean(payload.canPin),
  };
}

export function orderedLaborProducts(items = []) {
  return [...items].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) || left.code.localeCompare(right.code);
  });
}

export function laborProductLabel(product = {}) {
  const safeProduct = product && typeof product === "object" ? product : {};
  const name = String(safeProduct.name || "").trim() || "Labor hours";
  const code = String(safeProduct.code || "").trim();
  return code && !name.toLowerCase().startsWith(`[${code}]`.toLowerCase()) ? `[${code}] ${name}` : name;
}

export function localLaborProductValue(item = {}) {
  const normalized = normalizeLaborProductItem(item);
  return normalized.id ? {
    productId: normalized.id,
    externalId: "",
    code: normalized.code,
    name: normalized.name,
    ...(normalized.description ? { description: normalized.description } : {}),
    uomCode: "hr",
  } : null;
}

export function productMatchesValue(item, value) {
  return Boolean(item?.id) && String(value?.productId || "").trim() === item.id;
}

export function createLaborProductPayload({ locationId, name, code, description } = {}) {
  const cleanedName = String(name || "").trim();
  const cleanedCode = String(code || "").trim();
  if (!String(locationId || "").trim() || !cleanedName) return null;
  return {
    locationId: String(locationId).trim(),
    name: cleanedName,
    ...(cleanedCode ? { code: cleanedCode } : {}),
    ...(String(description || "").trim() ? { description: String(description).trim() } : {}),
  };
}

export function laborProductSelectionPatch(form, product) {
  const repairOrder = repairOrderAfterCatalogSelection(form.workPerformed, product || {}, form.laborProduct?.productId);
  return {
    laborProduct: product,
    ...(repairOrder !== form.workPerformed ? { workPerformed: repairOrder } : {}),
  };
}
