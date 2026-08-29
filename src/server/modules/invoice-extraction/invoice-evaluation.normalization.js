export const FIXED_NUMERIC_TOLERANCE = 0.000001;
export const FIXED_ARITHMETIC_TOLERANCE = 0.02;
const text = (value) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");

export function normalizeEvaluationValue(fieldPath, value) {
  if (value === null || value === undefined || text(value) === "") return null;
  if (["subtotal", "tax", "shipping", "total", "quantity", "unitPrice", "lineTotal"].includes(fieldPath)) {
    const parsed = typeof value === "number" ? value : Number(text(value).replace(/[$,]/g, "").replace(/^\((.*)\)$/, "-$1"));
    return Number.isFinite(parsed) ? Math.round(parsed / FIXED_NUMERIC_TOLERANCE) * FIXED_NUMERIC_TOLERANCE : Symbol.for("invalid-number");
  }
  if (fieldPath === "invoiceDate") {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text(value)) ? text(value) : null;
    return parsed || Symbol.for("invalid-date");
  }
  if (fieldPath === "currency") return text(value).toUpperCase();
  if (fieldPath === "partNumber") return text(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "");
  return text(value).toLocaleLowerCase("en-US");
}

export function typedValuesEqual(fieldPath, actual, expected) {
  const left = normalizeEvaluationValue(fieldPath, actual);
  const right = normalizeEvaluationValue(fieldPath, expected);
  return left !== null && right !== null && left === right;
}

export function isReturned(value) { return value !== null && value !== undefined && text(value) !== ""; }
