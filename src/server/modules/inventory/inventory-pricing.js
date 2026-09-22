// Generated from the official SIX ISO 4217 list one, published 2026-01-01.
// Source: https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml
// Entries whose CcyMnrUnts value is N.A. are intentionally unsupported.
const ISO_CURRENCY_MINOR_UNITS = Object.freeze({
  AED: 2, AFN: 2, ALL: 2, AMD: 2, AOA: 2, ARS: 2, AUD: 2, AWG: 2, AZN: 2,
  BAM: 2, BBD: 2, BDT: 2, BHD: 3, BIF: 0, BMD: 2, BND: 2, BOB: 2, BOV: 2,
  BRL: 2, BSD: 2, BTN: 2, BWP: 2, BYN: 2, BZD: 2, CAD: 2, CDF: 2, CHE: 2,
  CHF: 2, CHW: 2, CLF: 4, CLP: 0, CNY: 2, COP: 2, COU: 2, CRC: 2, CUP: 2,
  CVE: 2, CZK: 2, DJF: 0, DKK: 2, DOP: 2, DZD: 2, EGP: 2, ERN: 2, ETB: 2,
  EUR: 2, FJD: 2, FKP: 2, GBP: 2, GEL: 2, GHS: 2, GIP: 2, GMD: 2, GNF: 0,
  GTQ: 2, GYD: 2, HKD: 2, HNL: 2, HTG: 2, HUF: 2, IDR: 2, ILS: 2, INR: 2,
  IQD: 3, IRR: 2, ISK: 0, JMD: 2, JOD: 3, JPY: 0, KES: 2, KGS: 2, KHR: 2,
  KMF: 0, KPW: 2, KRW: 0, KWD: 3, KYD: 2, KZT: 2, LAK: 2, LBP: 2, LKR: 2,
  LRD: 2, LSL: 2, LYD: 3, MAD: 2, MDL: 2, MGA: 2, MKD: 2, MMK: 2, MNT: 2,
  MOP: 2, MRU: 2, MUR: 2, MVR: 2, MWK: 2, MXN: 2, MXV: 2, MYR: 2, MZN: 2,
  NAD: 2, NGN: 2, NIO: 2, NOK: 2, NPR: 2, NZD: 2, OMR: 3, PAB: 2, PEN: 2,
  PGK: 2, PHP: 2, PKR: 2, PLN: 2, PYG: 0, QAR: 2, RON: 2, RSD: 2, RUB: 2,
  RWF: 0, SAR: 2, SBD: 2, SCR: 2, SDG: 2, SEK: 2, SGD: 2, SHP: 2, SLE: 2,
  SOS: 2, SRD: 2, SSP: 2, STN: 2, SVC: 2, SYP: 2, SZL: 2, THB: 2, TJS: 2,
  TMT: 2, TND: 3, TOP: 2, TRY: 2, TTD: 2, TWD: 2, TZS: 2, UAH: 2, UGX: 0,
  USD: 2, USN: 2, UYI: 0, UYU: 2, UYW: 4, UZS: 2, VED: 2, VES: 2, VND: 0,
  VUV: 0, WST: 2, XAD: 2, XAF: 0, XCD: 2, XCG: 2, XOF: 0, XPF: 0, YER: 2,
  ZAR: 2, ZMW: 2, ZWG: 2,
});

function power10(value) { return 10n ** BigInt(value); }
function gcd(left, right) { let a = left < 0n ? -left : left; let b = right < 0n ? -right : right; while (b) [a, b] = [b, a % b]; return a || 1n; }
function fraction(numerator, denominator = 1n) {
  if (denominator === 0n) throw new Error("Cannot divide by zero.");
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor * sign, denominator: denominator / divisor * sign };
}
function add(left, right) { return fraction(left.numerator * right.denominator + right.numerator * left.denominator, left.denominator * right.denominator); }
function multiply(left, right) { return fraction(left.numerator * right.numerator, left.denominator * right.denominator); }
function divide(left, right) { return fraction(left.numerator * right.denominator, left.denominator * right.numerator); }

function parseDecimal(value, { maximumScale = 12, maximumIntegerDigits = 12 } = {}) {
  const text = String(value ?? "").trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || match[1].length > maximumIntegerDigits || (match[2]?.length || 0) > maximumScale) throw new Error("Invalid decimal value.");
  const decimals = match[2] || "";
  return fraction(BigInt(`${match[1]}${decimals}`), power10(decimals.length));
}

function roundHalfUp(value, minorDigits) {
  const scaledNumerator = value.numerator * power10(minorDigits);
  const quotient = scaledNumerator / value.denominator;
  const remainder = scaledNumerator % value.denominator;
  return quotient + (remainder * 2n >= value.denominator ? 1n : 0n);
}

function formatMinor(value, minorDigits) {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  if (minorDigits === 0) return `${sign}${absolute}`;
  const digits = absolute.toString().padStart(minorDigits + 1, "0");
  return `${sign}${digits.slice(0, -minorDigits)}.${digits.slice(-minorDigits)}`;
}

function normalizedDecimal(value) {
  const text = String(value).trim();
  if (!text.includes(".")) return text;
  return text.replace(/0+$/, "").replace(/\.$/, "");
}

export function isSupportedInventoryCurrency(value) {
  return Object.hasOwn(ISO_CURRENCY_MINOR_UNITS, String(value || "").trim().toUpperCase());
}

export function inventoryCurrencyMinorDigits(currency) {
  const code = String(currency || "").trim().toUpperCase();
  if (!isSupportedInventoryCurrency(code)) throw new Error("Unsupported currency.");
  return ISO_CURRENCY_MINOR_UNITS[code];
}

function rateFraction(rate) { return divide(parseDecimal(rate, { maximumScale: 4, maximumIntegerDigits: 3 }), fraction(100n)); }

function inclusiveAllocations(grossMinor, components) {
  let totalMultiplier = fraction(1n);
  const weights = components.map((component) => {
    const baseMultiplier = component.compound ? totalMultiplier : fraction(1n);
    const weight = multiply(baseMultiplier, rateFraction(component.rate));
    totalMultiplier = add(totalMultiplier, weight);
    return weight;
  });
  const exact = [fraction(grossMinor), ...weights.map((weight) => multiply(fraction(grossMinor), weight))]
    .map((weighted, index) => index === 0 ? divide(weighted, totalMultiplier) : divide(weighted, totalMultiplier));
  const allocations = exact.map((entry) => {
    const floor = entry.numerator / entry.denominator;
    const remainder = entry.numerator % entry.denominator;
    return { value: floor + (remainder * 2n >= entry.denominator ? 1n : 0n), remainder, denominator: entry.denominator };
  });
  let residual = grossMinor - allocations.reduce((sum, entry) => sum + entry.value, 0n);
  if (residual > 0n) {
    const order = allocations.map((entry, index) => ({ ...entry, index })).sort((a, b) => {
      const comparison = b.remainder * a.denominator - a.remainder * b.denominator;
      return comparison === 0n ? a.index - b.index : comparison > 0n ? 1 : -1;
    });
    for (let cursor = 0; residual > 0n; cursor += 1, residual -= 1n) allocations[order[cursor % order.length].index].value += 1n;
  } else if (residual < 0n) {
    const order = allocations.map((entry, index) => ({ ...entry, index })).sort((a, b) => {
      const comparison = a.remainder * b.denominator - b.remainder * a.denominator;
      if (comparison !== 0n) return comparison < 0n ? -1 : 1;
      return b.index - a.index;
    });
    let cursor = 0;
    while (residual < 0n) {
      const target = order[cursor % order.length].index;
      if (allocations[target].value > 0n) { allocations[target].value -= 1n; residual += 1n; }
      cursor += 1;
    }
  }
  return { netMinor: allocations[0].value, taxesMinor: allocations.slice(1).map((entry) => entry.value) };
}

export function calculateInventoryPricingPreview({ amount, currency, quantity, discountPercent = "0", taxTreatment, components = [] }) {
  const minorDigits = inventoryCurrencyMinorDigits(currency);
  const unitPrice = parseDecimal(amount, { maximumScale: 4, maximumIntegerDigits: 10 });
  const quantityValue = parseDecimal(quantity, { maximumScale: 3, maximumIntegerDigits: 9 });
  const discountRate = rateFraction(discountPercent);
  const subtotalMinor = roundHalfUp(multiply(unitPrice, quantityValue), minorDigits);
  const discountMinor = roundHalfUp(multiply(fraction(subtotalMinor), discountRate), 0);
  const discountedMinor = subtotalMinor - discountMinor;
  const common = {
    currency: String(currency).toUpperCase(),
    minorDigits,
    quantity: normalizedDecimal(quantity),
    unitPrice: normalizedDecimal(amount),
    subtotal: formatMinor(subtotalMinor, minorDigits),
    discountPercent: normalizedDecimal(discountPercent),
    discountAmount: formatMinor(discountMinor, minorDigits),
  };
  if (["legacy_unknown", "not_configured"].includes(taxTreatment)) {
    return { ...common, net: null, components: [], tax: null, total: null, blockers: ["tax_treatment_required"] };
  }
  if (["zero_rated", "exempt", "out_of_scope"].includes(taxTreatment)) {
    return { ...common, net: formatMinor(discountedMinor, minorDigits), components: [], tax: formatMinor(0n, minorDigits), total: formatMinor(discountedMinor, minorDigits), blockers: [] };
  }
  if (taxTreatment === "exclusive") {
    let runningTax = 0n;
    const taxes = components.map((component) => {
      const base = component.compound ? discountedMinor + runningTax : discountedMinor;
      const value = roundHalfUp(multiply(fraction(base), rateFraction(component.rate)), 0);
      runningTax += value;
      return { name: component.name, rate: normalizedDecimal(component.rate), compound: component.compound, tax: formatMinor(value, minorDigits) };
    });
    return { ...common, net: formatMinor(discountedMinor, minorDigits), components: taxes, tax: formatMinor(runningTax, minorDigits), total: formatMinor(discountedMinor + runningTax, minorDigits), blockers: [] };
  }
  if (taxTreatment === "inclusive") {
    const { netMinor, taxesMinor } = inclusiveAllocations(discountedMinor, components);
    const taxMinor = taxesMinor.reduce((sum, value) => sum + value, 0n);
    const taxes = components.map((component, index) => ({ name: component.name, rate: normalizedDecimal(component.rate), compound: component.compound, tax: formatMinor(taxesMinor[index], minorDigits) }));
    return { ...common, net: formatMinor(netMinor, minorDigits), components: taxes, tax: formatMinor(taxMinor, minorDigits), total: formatMinor(discountedMinor, minorDigits), blockers: [] };
  }
  throw new Error("Unsupported tax treatment.");
}
