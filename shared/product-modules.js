export const PRODUCT_MODULE_CATALOG_VERSION = 1;

export const PRODUCT_MODULE_MODES = Object.freeze({
  OFF: "off",
  READ: "read",
  FULL: "full",
});

export const PRODUCT_MODULES = Object.freeze([
  Object.freeze({ key: "workorders", label: "Workorders", compatibilityDefault: "full" }),
  Object.freeze({
    key: "inspections",
    label: "Inspections",
    compatibilityDefault: "off",
    roleDefaults: Object.freeze({ admin: "full", office: "full", mechanic: "full", surveillance: "read" }),
  }),
]);

export const PRODUCT_MODULE_ROLES = Object.freeze(["mechanic", "office", "surveillance", "admin"]);

const MODULE_BY_KEY = new Map(PRODUCT_MODULES.map((module) => [module.key, module]));
const MODES = new Set(Object.values(PRODUCT_MODULE_MODES));

export function getProductModule(key) {
  return MODULE_BY_KEY.get(String(key || "")) || null;
}

export function normalizeProductModuleMode(value, fallback = PRODUCT_MODULE_MODES.OFF) {
  const normalized = String(value || "").trim().toLowerCase();
  return MODES.has(normalized) ? normalized : fallback;
}

export function productModuleCompatibilityDefault(moduleKey, role = "") {
  const module = getProductModule(moduleKey);
  return module?.roleDefaults?.[role] || module?.compatibilityDefault || PRODUCT_MODULE_MODES.OFF;
}

export function modeAllows(mode, capability) {
  const normalized = normalizeProductModuleMode(mode);
  if (normalized === PRODUCT_MODULE_MODES.OFF) return false;
  if (capability === "read") return true;
  return normalized === PRODUCT_MODULE_MODES.FULL && capability === "write";
}

// Rules are already tenant/location scoped by the repository. Specificity is:
// location user, company user, location role, company role, compatibility default.
export function resolveProductModuleMode({ moduleKey, role, userId, companyRules = [], locationRules = [] }) {
  const matching = (rules, subjectType, subjectId) => rules.find((rule) => (
    rule.moduleKey === moduleKey
    && rule.subjectType === subjectType
    && rule.subjectId === subjectId
  ));
  const candidates = [
    [matching(locationRules, "user", userId), "location_user"],
    [matching(companyRules, "user", userId), "company_user"],
    [matching(locationRules, "role", role), "location_role"],
    [matching(companyRules, "role", role), "company_role"],
  ];
  const winner = candidates.find(([rule]) => rule);
  if (winner) return { mode: normalizeProductModuleMode(winner[0].mode), source: winner[1], version: Number(winner[0].version || 1) };
  return { mode: productModuleCompatibilityDefault(moduleKey, role), source: "compatibility_default", version: 0 };
}

export function emptyProductModuleMap() {
  return Object.fromEntries(PRODUCT_MODULES.map((module) => [module.key, module.compatibilityDefault]));
}
