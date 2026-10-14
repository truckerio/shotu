import { WorkorderPricingFooter } from "./WorkorderPricingFooter.jsx";
import { workorderPricingPresentation } from "./workorder-pricing-model.js";

export function WorkorderPricingSummary({ pricing, projection = null, discountControl = null, message = "" }) {
  const pricingView = workorderPricingPresentation(pricing);
  const summaryMessage = message || (!projection?.financialFingerprint && pricingView.status !== "complete" ? pricingView.message : "");
  return <WorkorderPricingFooter
    pricing={pricing}
    projection={projection}
    discountControl={discountControl}
    message={summaryMessage}
  />;
}
