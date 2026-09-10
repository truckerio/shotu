export function normalizeLaborProductItem(item = {}) {
  const id = String(item.id || item.productId || "").trim();
  const name = String(item.name || "").trim();
  return {
    id,
    name,
    code: String(item.code || "").trim(),
    uomCode: "hr",
    pinned: Boolean(item.pinned),
  };
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
    uomCode: "hr",
  } : null;
}

export function productMatchesValue(item, value) {
  return Boolean(item?.id) && String(value?.productId || "").trim() === item.id;
}

export function createLaborProductPayload({ locationId, name, code } = {}) {
  const cleanedName = String(name || "").trim();
  const cleanedCode = String(code || "").trim();
  if (!String(locationId || "").trim() || !cleanedName) return null;
  return {
    locationId: String(locationId).trim(),
    name: cleanedName,
    ...(cleanedCode ? { code: cleanedCode } : {}),
  };
}
