import { workorderPricingFooterPresentation } from "./workorder-pricing-footer-model.js";
import "./workorder-pricing-footer.css";

function PricingRow({ label, value, placeholder = false, total = false }) {
  return <div className={`workorder-pricing-footer-row${total ? " is-total" : ""}`}>
    <span>{label}</span>
    <strong className={placeholder ? "is-placeholder" : undefined}>{value}</strong>
  </div>;
}

export function WorkorderPricingFooter({ pricing, projection = null, discountControl = null, message = "" }) {
  const view = workorderPricingFooterPresentation(pricing, projection, message);
  return <section className="workorder-pricing-footer" aria-label="Workorder pricing">
    <PricingRow label="Parts & labor" value={view.partsLabor} placeholder={view.partsLabor === "—"} />
    {discountControl || <PricingRow label="Discount" value={view.discount} placeholder />}
    <PricingRow label="Tax" value={view.tax} placeholder={view.tax === "—"} />
    <PricingRow label="Total" value={view.total} placeholder={view.total === "—"} total />
    {view.message ? <p role="status" className="workorder-pricing-footer-message">{view.message}</p> : null}
  </section>;
}
