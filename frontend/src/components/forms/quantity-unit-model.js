import {
  DEFAULT_UOM_CODE,
  UNITS_OF_MEASURE,
  UOM_CATEGORIES,
  formatQuantity,
  getUnitDefinition,
  normalizeQuantity,
  normalizeUomCode,
  quantityStep,
} from "../../../../shared/units-of-measure.js";

export const COMMON_UOM_CODES = Object.freeze([
  "pc",
  "ea",
  "qt",
  "gal",
  "fl_oz",
  "lb",
  "oz",
  "ft",
  "cylinder",
]);

export function quantityInputModel(quantity, uomCode) {
  const code = normalizeUomCode(uomCode);
  const definition = getUnitDefinition(code);
  return {
    code,
    quantity: quantity === null || quantity === undefined ? "" : String(quantity),
    step: quantityStep(code),
    decimalScale: definition.decimalScale,
    symbol: definition.symbol,
  };
}

export function normalizeQuantityInput(quantity, uomCode) {
  return normalizeQuantity(quantity, normalizeUomCode(uomCode));
}

export function normalizeQuantityUnit(quantity, uomCode) {
  const code = normalizeUomCode(uomCode);
  return {
    quantity: normalizeQuantityInput(quantity, code),
    uomCode: code,
  };
}

export function formatQuantityUnit(quantity, uomCode = DEFAULT_UOM_CODE) {
  const code = normalizeUomCode(uomCode);
  const definition = getUnitDefinition(code);
  const value = quantity === "" || quantity === null || quantity === undefined ? 1 : quantity;
  return formatQuantity(value, code) || `${String(value)} ${definition.symbol}`;
}

export function unitOptionGroups(query = "", labelFor = (_kind, _value, fallback) => fallback) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const matches = (definition) => !normalizedQuery
    || definition.code.includes(normalizedQuery)
    || definition.label.toLowerCase().includes(normalizedQuery)
    || labelFor("unit", definition.code, definition.label).toLowerCase().includes(normalizedQuery)
    || definition.symbol.toLowerCase().includes(normalizedQuery);
  const commonCodes = new Set(COMMON_UOM_CODES);
  const common = COMMON_UOM_CODES
    .map((code) => getUnitDefinition(code))
    .filter((definition) => definition && matches(definition));
  const categories = Object.entries(UOM_CATEGORIES)
    .map(([category, config]) => ({
      category,
      label: labelFor("category", category, config.label),
      units: UNITS_OF_MEASURE.filter((definition) => (
        definition.category === category
        && !commonCodes.has(definition.code)
        && matches(definition)
      )),
    }))
    .filter((group) => group.units.length);

  return [
    ...(common.length ? [{ category: "common", label: labelFor("category", "common", "Common"), units: common }] : []),
    ...categories,
  ];
}
