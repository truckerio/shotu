import { createHash } from "node:crypto";
import { CUSTOMER_DOCUMENT_LINE_TYPE } from "../../../../shared/customer-document-contract.js";
import { parseCustomerFinancialCalculation } from "./customer-financial.schemas.js";
import {
  addFraction,
  currencyMinorDigits,
  divideFraction,
  formatMinorUnits,
  fraction,
  multiplyFraction,
  normalizeFinancialDecimal,
  parseFinancialDecimal,
  percentageFraction,
  roundHalfUp,
} from "./financial-money.js";

function fixedMinor(value, minorDigits) {
  return roundHalfUp(parseFinancialDecimal(value, { maximumScale: 4, maximumIntegerDigits: 12, signed: true }), minorDigits);
}

function percentageMinor(baseMinor, value) {
  return roundHalfUp(multiplyFraction(fraction(baseMinor), percentageFraction(value)), 0);
}

function discountMinor(baseMinor, discount, minorDigits) {
  if (!discount) return 0n;
  const calculated = discount.kind === "fixed"
    ? fixedMinor(discount.value, minorDigits)
    : percentageMinor(baseMinor, discount.value);
  if (calculated < 0n || calculated > baseMinor) throw new Error("Discount cannot exceed its eligible amount.");
  return calculated;
}

function proportionalAllocations(lines, totalMinor) {
  if (totalMinor === 0n) return new Map(lines.map((line) => [line.id, 0n]));
  const denominator = lines.reduce((sum, line) => sum + line.discountBaseMinor, 0n);
  if (denominator <= 0n || totalMinor > denominator) throw new Error("Document discount cannot exceed eligible lines.");
  const allocations = lines.map((line) => {
    const numerator = totalMinor * line.discountBaseMinor;
    return { id: line.id, value: numerator / denominator, remainder: numerator % denominator };
  });
  let residual = totalMinor - allocations.reduce((sum, allocation) => sum + allocation.value, 0n);
  const order = [...allocations].sort((left, right) => {
    if (left.remainder !== right.remainder) return left.remainder > right.remainder ? -1 : 1;
    return left.id.localeCompare(right.id);
  });
  for (let cursor = 0; residual > 0n; cursor += 1, residual -= 1n) {
    order[cursor % order.length].value += 1n;
  }
  return new Map(allocations.map((allocation) => [allocation.id, allocation.value]));
}

function inclusiveTax(baseMinor, components) {
  let totalMultiplier = fraction(1n);
  const weights = components.map((component) => {
    const baseMultiplier = component.compound ? totalMultiplier : fraction(1n);
    const weight = multiplyFraction(baseMultiplier, percentageFraction(component.rate));
    totalMultiplier = addFraction(totalMultiplier, weight);
    return weight;
  });
  const exact = [fraction(baseMinor), ...weights.map((weight) => multiplyFraction(fraction(baseMinor), weight))]
    .map((entry) => divideFraction(entry, totalMultiplier));
  const allocations = exact.map((entry, index) => ({
    index,
    value: entry.numerator / entry.denominator,
    remainder: entry.numerator % entry.denominator,
    denominator: entry.denominator,
  }));
  let residual = baseMinor - allocations.reduce((sum, entry) => sum + entry.value, 0n);
  const order = [...allocations].sort((left, right) => {
    const comparison = right.remainder * left.denominator - left.remainder * right.denominator;
    return comparison === 0n ? left.index - right.index : comparison > 0n ? 1 : -1;
  });
  for (let cursor = 0; residual > 0n; cursor += 1, residual -= 1n) {
    order[cursor % order.length].value += 1n;
  }
  return { netMinor: allocations[0].value, taxes: allocations.slice(1).map((entry) => entry.value) };
}

function lineTax(baseMinor, treatment, components) {
  if (["zero_rated", "exempt", "out_of_scope"].includes(treatment)) {
    return { netMinor: baseMinor, totalMinor: baseMinor, taxMinor: 0n, components: [] };
  }
  if (treatment === "not_configured") throw new Error("Every customer line requires an explicit tax treatment.");
  if (!components.length) throw new Error("Taxed lines require tax components.");
  if (treatment === "inclusive") {
    const included = inclusiveTax(baseMinor, components);
    const taxMinor = included.taxes.reduce((sum, value) => sum + value, 0n);
    return { netMinor: included.netMinor, totalMinor: baseMinor, taxMinor, components: included.taxes };
  }
  if (treatment !== "exclusive") throw new Error("Unsupported tax treatment.");
  let runningTax = 0n;
  const taxes = components.map((component) => {
    const taxable = component.compound ? baseMinor + runningTax : baseMinor;
    const value = percentageMinor(taxable, component.rate);
    runningTax += value;
    return value;
  });
  return { netMinor: baseMinor, totalMinor: baseMinor + runningTax, taxMinor: runningTax, components: taxes };
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalFinancialHash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function calculateCustomerFinancials(rawInput) {
  const input = parseCustomerFinancialCalculation(rawInput);
  const minorDigits = currencyMinorDigits(input.currency);
  const prepared = input.lines.map((line) => {
    const quantity = parseFinancialDecimal(line.quantity, { maximumScale: 3, maximumIntegerDigits: 9 });
    const unitPrice = parseFinancialDecimal(line.unitPrice, { maximumScale: 4, maximumIntegerDigits: 10 });
    const unsignedGross = roundHalfUp(multiplyFraction(quantity, unitPrice), minorDigits);
    const sign = line.type === CUSTOMER_DOCUMENT_LINE_TYPE.CREDIT ? -1n : 1n;
    const lineDiscountMinor = sign < 0n ? 0n : discountMinor(unsignedGross, line.lineDiscount, minorDigits);
    return {
      ...line,
      quantity: normalizeFinancialDecimal(line.quantity),
      unitPrice: normalizeFinancialDecimal(line.unitPrice),
      sign,
      grossMinor: sign * unsignedGross,
      lineDiscountMinor,
      discountBaseMinor: sign > 0n && line.discountEligible ? unsignedGross - lineDiscountMinor : 0n,
    };
  });
  const eligible = prepared.filter((line) => line.discountBaseMinor > 0n);
  const eligibleTotal = eligible.reduce((sum, line) => sum + line.discountBaseMinor, 0n);
  const documentDiscountMinor = discountMinor(eligibleTotal, input.documentDiscount, minorDigits);
  const allocations = proportionalAllocations(eligible, documentDiscountMinor);
  const lines = prepared.map((line) => {
    const documentDiscountAllocationMinor = allocations.get(line.id) || 0n;
    const taxableMinor = line.grossMinor - line.lineDiscountMinor - documentDiscountAllocationMinor;
    const sign = taxableMinor < 0n ? -1n : 1n;
    const tax = lineTax(sign * taxableMinor, line.taxTreatment, line.taxComponents);
    const componentTaxes = line.taxComponents.map((component, index) => ({
      name: component.name,
      rate: normalizeFinancialDecimal(component.rate),
      compound: component.compound,
      amount: formatMinorUnits(sign * (tax.components[index] || 0n), minorDigits),
    }));
    return {
      id: line.id,
      type: line.type,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      priceBasis: line.priceBasis,
      taxCategory: line.taxCategory,
      taxTreatment: line.taxTreatment,
      discountEligible: line.discountEligible,
      source: line.source,
      gross: formatMinorUnits(line.grossMinor, minorDigits),
      lineDiscount: formatMinorUnits(line.lineDiscountMinor, minorDigits),
      documentDiscountAllocation: formatMinorUnits(documentDiscountAllocationMinor, minorDigits),
      net: formatMinorUnits(sign * tax.netMinor, minorDigits),
      tax: formatMinorUnits(sign * tax.taxMinor, minorDigits),
      total: formatMinorUnits(sign * tax.totalMinor, minorDigits),
      taxComponents: componentTaxes,
    };
  });
  const sum = (field) => lines.reduce((total, line) => total + fixedMinor(line[field], minorDigits), 0n);
  const summary = {
    currency: input.currency,
    minorDigits,
    subtotal: formatMinorUnits(sum("gross"), minorDigits),
    lineDiscount: formatMinorUnits(sum("lineDiscount"), minorDigits),
    documentDiscount: formatMinorUnits(documentDiscountMinor, minorDigits),
    discountTotal: formatMinorUnits(sum("lineDiscount") + documentDiscountMinor, minorDigits),
    net: formatMinorUnits(sum("net"), minorDigits),
    tax: formatMinorUnits(sum("tax"), minorDigits),
    total: formatMinorUnits(sum("total"), minorDigits),
  };
  const result = { basis: input.basis, currency: input.currency, minorDigits, lines, summary };
  return { ...result, fingerprint: canonicalFinancialHash(result) };
}
