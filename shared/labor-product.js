export const DEFAULT_LABOR_PRODUCT = Object.freeze({
  externalId: "",
  code: "",
  name: "Labor hours",
  uomCode: "hr",
});

export function normalizeLaborProduct(product) {
  if (!product || typeof product !== "object" || Array.isArray(product)) {
    return { ...DEFAULT_LABOR_PRODUCT };
  }
  return {
    externalId: String(product.externalId || product.external_id || "").trim(),
    code: String(product.code || product.defaultCode || product.default_code || "").trim(),
    name: String(product.name || product.displayName || product.display_name || "").trim()
      || DEFAULT_LABOR_PRODUCT.name,
    uomCode: "hr",
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
