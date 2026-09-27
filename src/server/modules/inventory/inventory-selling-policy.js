export const SELLING_POLICY_METHODS = Object.freeze(["fixed", "markup_percent", "markup_amount"]);

const SCALE = 10_000n;

function scaledDecimal(value, label) {
  const match = /^(\d{1,14})(?:\.(\d{1,4}))?$/.exec(String(value ?? "").trim());
  if (!match) throw new TypeError(`${label} must be a non-negative number with at most four decimal places.`);
  return BigInt(match[1]) * SCALE + BigInt((match[2] || "").padEnd(4, "0"));
}

function roundDivide(numerator, denominator) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return quotient + (remainder * 2n >= denominator ? 1n : 0n);
}

function fixedFour(value) {
  const whole = value / SCALE;
  const decimals = (value % SCALE).toString().padStart(4, "0");
  return `${whole}.${decimals}`;
}

export function calculateSellingUnitPrice(policy, batchCost) {
  if (!policy) return null;
  const value = scaledDecimal(policy.value, "Selling policy value");
  if (policy.method === "fixed") return fixedFour(value);
  const cost = scaledDecimal(batchCost, "Batch cost");
  if (policy.method === "markup_percent") {
    return fixedFour(roundDivide(cost * (100n * SCALE + value), 100n * SCALE));
  }
  if (policy.method === "markup_amount") return fixedFour(cost + value);
  throw new TypeError("Unsupported selling policy method.");
}

export function sellingPolicyCurrency(policy, batchCurrency) {
  if (!policy) return null;
  if (policy.method === "markup_percent") return batchCurrency || null;
  return policy.currency || null;
}
