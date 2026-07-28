export const DEFAULT_UOM_CODE = "pc";
export const MAX_QUANTITY = 999_999.999;

export const UOM_CATEGORIES = Object.freeze({
  count: { label: "Count", decimalScale: 0 },
  packaging: { label: "Packaging", decimalScale: 0 },
  liquid_volume: { label: "Liquid volume", decimalScale: 3 },
  mass: { label: "Weight", decimalScale: 3 },
  gas_volume: { label: "Gas volume", decimalScale: 3 },
  length: { label: "Length", decimalScale: 3 },
});

function unit(code, label, symbol, category, options = {}) {
  return Object.freeze({
    code,
    label,
    symbol,
    category,
    decimalScale: UOM_CATEGORIES[category].decimalScale,
    conversionFactor: null,
    referenceCode: null,
    ...options,
  });
}

export const UNITS_OF_MEASURE = Object.freeze([
  unit("ea", "Each", "ea", "count", { conversionFactor: 1, referenceCode: "ea", odooName: "Units" }),
  unit("pc", "Piece", "pc", "count", { conversionFactor: 1, referenceCode: "ea", odooName: "Units" }),
  unit("pair", "Pair", "pair", "count", { conversionFactor: 2, referenceCode: "ea" }),
  unit("set", "Set", "set", "packaging"),

  unit("pack", "Pack", "pack", "packaging"),
  unit("box", "Box", "box", "packaging"),
  unit("case", "Case", "case", "packaging"),
  unit("roll", "Roll", "roll", "packaging"),
  unit("tube", "Tube", "tube", "packaging"),
  unit("cartridge", "Cartridge", "cartridge", "packaging"),
  unit("bottle", "Bottle", "bottle", "packaging"),
  unit("can", "Can", "can", "packaging"),
  unit("jug", "Jug", "jug", "packaging"),
  unit("pail", "Pail", "pail", "packaging"),
  unit("drum", "Drum", "drum", "packaging"),
  unit("cylinder", "Cylinder", "cyl", "packaging"),

  unit("fl_oz", "Fluid ounce", "fl oz", "liquid_volume", {
    conversionFactor: 29.5735295625,
    referenceCode: "ml",
  }),
  unit("pt", "Pint", "pt", "liquid_volume", {
    conversionFactor: 473.176473,
    referenceCode: "ml",
  }),
  unit("qt", "Quart", "qt", "liquid_volume", {
    conversionFactor: 946.352946,
    referenceCode: "ml",
  }),
  unit("gal", "Gallon", "gal", "liquid_volume", {
    conversionFactor: 3785.411784,
    referenceCode: "ml",
  }),
  unit("ml", "Milliliter", "mL", "liquid_volume", {
    conversionFactor: 1,
    referenceCode: "ml",
    odooName: "Milliliters",
  }),
  unit("l", "Liter", "L", "liquid_volume", {
    conversionFactor: 1000,
    referenceCode: "ml",
    odooName: "Liters",
  }),

  unit("oz", "Ounce", "oz", "mass", {
    conversionFactor: 28.349523125,
    referenceCode: "g",
  }),
  unit("lb", "Pound", "lb", "mass", {
    conversionFactor: 453.59237,
    referenceCode: "g",
    odooName: "lb",
  }),
  unit("g", "Gram", "g", "mass", {
    conversionFactor: 1,
    referenceCode: "g",
    odooName: "g",
  }),
  unit("kg", "Kilogram", "kg", "mass", {
    conversionFactor: 1000,
    referenceCode: "g",
    odooName: "kg",
  }),

  unit("ft3", "Cubic foot", "ft³", "gas_volume", {
    conversionFactor: 1,
    referenceCode: "ft3",
  }),
  unit("m3", "Cubic meter", "m³", "gas_volume", {
    conversionFactor: 35.3146667215,
    referenceCode: "ft3",
  }),

  unit("in", "Inch", "in", "length", {
    conversionFactor: 25.4,
    referenceCode: "mm",
  }),
  unit("ft", "Foot", "ft", "length", {
    conversionFactor: 304.8,
    referenceCode: "mm",
    odooName: "ft",
  }),
  unit("yd", "Yard", "yd", "length", {
    conversionFactor: 914.4,
    referenceCode: "mm",
  }),
  unit("mm", "Millimeter", "mm", "length", {
    conversionFactor: 1,
    referenceCode: "mm",
  }),
  unit("cm", "Centimeter", "cm", "length", {
    conversionFactor: 10,
    referenceCode: "mm",
    odooName: "cm",
  }),
  unit("m", "Meter", "m", "length", {
    conversionFactor: 1000,
    referenceCode: "mm",
    odooName: "m",
  }),
]);

export const UOM_BY_CODE = Object.freeze(
  Object.fromEntries(UNITS_OF_MEASURE.map((definition) => [definition.code, definition])),
);

export function getUnitDefinition(code) {
  return UOM_BY_CODE[String(code || "").trim().toLowerCase()] || null;
}

export function normalizeUomCode(code, fallback = DEFAULT_UOM_CODE) {
  return getUnitDefinition(code)?.code || fallback;
}

export function unitAllowsDecimals(code) {
  return (getUnitDefinition(code) || UOM_BY_CODE[DEFAULT_UOM_CODE]).decimalScale > 0;
}

export function quantityStep(code) {
  const scale = (getUnitDefinition(code) || UOM_BY_CODE[DEFAULT_UOM_CODE]).decimalScale;
  return scale === 0 ? "1" : `0.${"0".repeat(scale - 1)}1`;
}

export function normalizeQuantity(value, code = DEFAULT_UOM_CODE) {
  if (value === "" || value === null || value === undefined) return "";
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) return "";
  const scale = (getUnitDefinition(code) || UOM_BY_CODE[DEFAULT_UOM_CODE]).decimalScale;
  if (scale === 0 && !Number.isInteger(quantity)) return "";
  return Number(quantity.toFixed(scale)).toString();
}

export function formatQuantity(value, code = DEFAULT_UOM_CODE) {
  const definition = getUnitDefinition(code) || UOM_BY_CODE[DEFAULT_UOM_CODE];
  const normalized = normalizeQuantity(value, definition.code);
  if (!normalized) return "";
  return `${normalized} ${definition.symbol}`;
}

export function convertQuantity(value, fromCode, toCode) {
  const from = getUnitDefinition(fromCode);
  const to = getUnitDefinition(toCode);
  const quantity = Number(value);
  if (
    !from
    || !to
    || from.category !== to.category
    || !from.conversionFactor
    || !to.conversionFactor
    || !Number.isFinite(quantity)
  ) {
    return null;
  }
  return quantity * from.conversionFactor / to.conversionFactor;
}
