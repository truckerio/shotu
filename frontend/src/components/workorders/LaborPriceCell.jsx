import { useEffect, useRef, useState } from "react";
import { WorkorderUnitPriceInput } from "./WorkorderUnitPriceInput.jsx";
import { PriceSourceDropdown } from "./PriceSourceDropdown.jsx";
import { LaborRatesDialog } from "./LaborRatesDialog.jsx";
import { api } from "../../lib/api.js";
import { formatWorkorderMoney, workorderLineTotal } from "./workorder-pricing-model.js";

export function LaborPriceCell({ workorderId, locationId, productId, hours, uomCode = "hr", price, currentRates = {}, onChanged, disabled = false, compact = false }) {
  const [current, setCurrent] = useState(price || null);
  const [busy, setBusy] = useState(false);
  const pendingPriceCommand = useRef(null);
  const [message, setMessage] = useState("");
  const [ratesOpen, setRatesOpen] = useState(false);
  const [needsPriceSelection, setNeedsPriceSelection] = useState(false);
  const selectedPrice = current?.selection
    && current.productId === productId
    && Number(current.hours) === Number(hours)
    ? current : null;
  useEffect(() => setCurrent(price || null), [price]);

  async function select(event, customUnitPrice) {
    const selection = event.target.value;
    if (!selection || busy || disabled) return;
    if (selection === "set_rates") {
      setRatesOpen(true);
      return;
    }
    const expectedRateVersionId = currentRates[selection]?.id;
    setBusy(true);
    setMessage("");
    try {
      const command = {
        operation: "laborPriceSelection", selection,
        ...(customUnitPrice !== undefined ? { customUnitPrice } : {}),
        ...(expectedRateVersionId ? { expectedRateVersionId } : {}),
        reason: customUnitPrice !== undefined ? "Manually entered Workorder labor unit price" : selection === "internal_cost"
          ? "Use configured internal labor cost" : "Use configured labor selling price",
      };
      const signature = JSON.stringify({ workorderId, ...command });
      if (pendingPriceCommand.current?.signature !== signature) {
        pendingPriceCommand.current = { signature, body: { ...command, idempotencyKey: `labor-price-${crypto.randomUUID()}` } };
      }
      const result = await api(`/api/workorders/${encodeURIComponent(workorderId)}/modules/diagnosisRepair/actions/record`, {
        method: "POST",
        body: JSON.stringify(pendingPriceCommand.current.body),
      });
      pendingPriceCommand.current = null;
      setCurrent(result.result?.laborPrice || result.laborPrice || result.snapshot || null);
      setNeedsPriceSelection(false);
      try { await onChanged?.(); }
      catch { setMessage("Labor price selected. Refresh the workorder to update totals."); }
    } catch (error) {
      setMessage(error?.message || "Labor price could not be selected.");
    } finally {
      setBusy(false);
    }
  }

  const options = Object.fromEntries(["internal_cost", "selling_price"].map((kind) => [kind, {
    status: Number(hours) > 0 ? currentRates[kind]?.status : "incomplete",
    price: { unitPrice: currentRates[kind]?.amount, currency: currentRates[kind]?.currency },
  }]));
  const selector = <PriceSourceDropdown aria-label="Labor price source" className={compact ? "detail-price-source-menu" : undefined}
    value={needsPriceSelection ? "" : selectedPrice?.selection || ""} options={options} includeBatch={false} onChange={select}
    onSetRates={productId && !disabled ? () => setRatesOpen(true) : undefined} disabled={busy || disabled || !productId} />;
  const ratesDialog = ratesOpen ? <LaborRatesDialog open onClose={() => setRatesOpen(false)} workorderId={workorderId}
    locationId={locationId} productId={productId} uomCode={uomCode} rates={currentRates}
    onSaved={async () => { setNeedsPriceSelection(true); setMessage("Rate saved. Select a price source to apply it to this workorder."); try { await onChanged?.(); } catch { setMessage("Rate saved. Refresh the workorder before selecting its price."); } }} /> : null;

  const priceInput = <WorkorderUnitPriceInput label="Labor unit price" price={selectedPrice}
    disabled={busy || disabled || !productId || needsPriceSelection}
    onCommit={(value) => select({ target: { value: selectedPrice?.selection } }, value)} />;

  if (compact) return <div className="used-part-field workorder-part-price workorder-labor-price is-compact">
    <span className="used-part-cell-label">Labor price</span>
    <div className="detail-inline-price-control">
      <span aria-hidden="true">{selectedPrice?.currency === "USD" || !selectedPrice?.currency ? "$" : selectedPrice.currency}</span>
      {priceInput}
      {selector}
    </div>
    {ratesDialog}
    {message ? <small role={message.startsWith("Rate saved") || message.startsWith("Labor price selected") ? "status" : "alert"}>{message}</small> : null}
  </div>;

  return <div className="used-part-field workorder-part-price workorder-labor-price">
    <span className="used-part-cell-label">Labor price</span>
    <div className="detail-inline-price-control"><span aria-hidden="true">{selectedPrice?.currency || "$"}</span>{priceInput}{selector}</div>
    <div className="workorder-price-values">
      <span>Rate <strong>{formatWorkorderMoney(selectedPrice?.unitPrice, selectedPrice?.currency) || "Not selected"} / {uomCode === "ea" ? "service" : "hr"}</strong></span>
      <span>Line total <strong>{workorderLineTotal(selectedPrice, hours) || "Incomplete"}</strong></span>
    </div>
    {ratesDialog}
    {message ? <small role={message.startsWith("Rate saved") || message.startsWith("Labor price selected") ? "status" : "alert"}>{message}</small> : null}
  </div>;
}
