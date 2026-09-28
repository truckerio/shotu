export function formatWorkorderMoney(value, currency) {
  if (value === null || value === undefined || value === "" || !currency) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function workorderLineTotal(price, quantity) {
  if (!price?.selection || !price.currency) return null;
  if (quantity === "" || quantity === null || quantity === undefined) return null;
  const count = Number(quantity);
  if (!Number.isFinite(count) || count < 0) return null;
  if (price.quantity !== null && price.quantity !== undefined) {
    const snapshotQuantity = Number(price.quantity);
    if (!Number.isFinite(snapshotQuantity) || snapshotQuantity !== count) return null;
  }
  if (price.totalPrice !== null && price.totalPrice !== undefined) {
    return formatWorkorderMoney(price.totalPrice, price.currency);
  }
  const amount = Number(price.unitPrice);
  if (price.unitPrice === null || price.unitPrice === undefined) return null;
  if (!Number.isFinite(amount)) return null;
  return formatWorkorderMoney(amount * count, price.currency);
}

export function workorderPricingPresentation(pricing) {
  if (pricing?.status === "mixed_currency") {
    return { status: "mixed_currency", message: "Mixed currencies. Resolve prices to show a workorder total." };
  }
  const currency = pricing?.currency;
  const parts = formatWorkorderMoney(pricing?.partsTotal, currency);
  const labor = formatWorkorderMoney(pricing?.laborTotal, currency);
  const grand = formatWorkorderMoney(pricing?.grandTotal, currency);
  if (pricing?.status === "complete" && parts && labor && grand) {
    return { status: "complete", parts, labor, grand };
  }
  if (pricing?.reason === "mixed_price_basis") {
    return { status: "incomplete", message: "Incomplete pricing. Internal cost and selling prices are mixed." };
  }
  const count = Number(pricing?.missingCount);
  const missing = Number.isInteger(count) && count > 0 ? ` ${count} ${count === 1 ? "line needs" : "lines need"} a price.` : "";
  return { status: "incomplete", message: `Incomplete pricing.${missing}` };
}
