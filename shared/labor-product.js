export const DEFAULT_LABOR_PRODUCT = Object.freeze({
  externalId: "",
  code: "",
  name: "Labor hours",
  uomCode: "hr",
});

export function validLaborQuantity(value, uomCode = "hr") {
  if (uomCode !== "hr" && uomCode !== "ea") return false;
  const raw = String(value ?? "").trim();
  if (!(uomCode === "ea" ? /^(?:0|[1-9]\d*)$/ : /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/).test(raw)) return false;
  const quantity = Number(raw);
  return quantity > 0 && quantity <= 9999;
}

export function normalizeLaborProduct(product) {
  if (!product || typeof product !== "object" || Array.isArray(product)) {
    return { ...DEFAULT_LABOR_PRODUCT };
  }
  return {
    externalId: String(product.externalId || product.external_id || "").trim(),
    code: String(product.code || product.defaultCode || product.default_code || "").trim(),
    name: String(product.name || product.displayName || product.display_name || "").trim()
      || DEFAULT_LABOR_PRODUCT.name,
    uomCode: product.uomCode === "ea" || product.uom_code === "ea" ? "ea" : "hr",
  };
}

export function laborProductLabel(product) {
  const normalized = normalizeLaborProduct(product);
  if (!normalized.code) return normalized.name;
  const prefix = `[${normalized.code}]`;
  return normalized.name.toLowerCase().startsWith(prefix.toLowerCase())
    ? normalized.name
    : `${prefix} ${normalized.name}`;
}

export function configuredLaborProduct(product) {
  const normalized = normalizeLaborProduct(product);
  return normalized.externalId ? normalized : null;
}

export function localLaborProductSnapshot(product) {
  if (!product || typeof product !== "object" || Array.isArray(product)) return null;
  const productId = String(product.productId || product.product_id || product.id || "").trim();
  const name = String(product.name || product.displayName || product.display_name || "").trim();
  const description = String(product.description || "").trim();
  if (!productId || !name) return null;
  return {
    productId,
    externalId: "",
    code: String(product.code || product.defaultCode || product.default_code || "").trim(),
    name,
    uomCode: product.uomCode === "ea" || product.uom_code === "ea" ? "ea" : "hr",
    ...(description ? { description } : {}),
  };
}
