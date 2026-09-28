import { workorderPricingPresentation } from "./workorder-pricing-model.js";

export function WorkorderPricingSummary({ pricing }) {
  const view = workorderPricingPresentation(pricing);
  return <section className="workorder-pricing-summary" aria-label="Workorder pricing">
    {view.status === "complete" ? <dl>
      <div><dt>Parts</dt><dd>{view.parts}</dd></div>
      <div><dt>Labor</dt><dd>{view.labor}</dd></div>
      <div className="workorder-pricing-grand-total"><dt>Grand total</dt><dd>{view.grand}</dd></div>
    </dl> : <p role="status" className="workorder-pricing-incomplete">{view.message}</p>}
  </section>;
}
