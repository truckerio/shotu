import { formatWorkorderMoney, workorderPricingPresentation } from "./workorder-pricing-model.js";

const PLACEHOLDER = "—";

function projectionMoney(projection, key) {
  return formatWorkorderMoney(projection?.[key], projection?.currency) || PLACEHOLDER;
}

export function workorderPricingFooterPresentation(pricing, projection = null, message = "") {
  const currentProjection = projection?.financialFingerprint ? projection : null;
  const rawPricing = workorderPricingPresentation(pricing);
  const rawPartsLabor = rawPricing.status === "complete"
    ? rawPricing.grand
    : null;
  const explicitMessage = String(message || "").trim();

  return {
    partsLabor: currentProjection ? projectionMoney(currentProjection, "subtotal") : rawPartsLabor || PLACEHOLDER,
    discount: currentProjection ? projectionMoney(currentProjection, "discount") : PLACEHOLDER,
    tax: currentProjection ? projectionMoney(currentProjection, "tax") : PLACEHOLDER,
    total: currentProjection ? projectionMoney(currentProjection, "total") : PLACEHOLDER,
    hasProjection: Boolean(currentProjection),
    hasRawPartsLabor: Boolean(rawPartsLabor),
    message: explicitMessage,
  };
}
