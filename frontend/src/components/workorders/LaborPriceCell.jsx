import { useEffect, useState } from "react";
import { Dropdown } from "../forms/Dropdown.jsx";
import { ModalFrame } from "../ui/ModalFrame.jsx";
import { api } from "../../lib/api.js";
import { formatWorkorderMoney, workorderLineTotal } from "./workorder-pricing-model.js";

export function LaborPriceCell({ workorderId, locationId, productId, hours, uomCode = "hr", price, currentRates = {}, onChanged, disabled = false, compact = false }) {
  const [current, setCurrent] = useState(price || null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [priceKind, setPriceKind] = useState("selling_price");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [reason, setReason] = useState("");
  const [ratesOpen, setRatesOpen] = useState(false);
  const selectedPrice = current?.selection
    && current.productId === productId
    && Number(current.hours) === Number(hours)
    ? current : null;
  const selectedRate = currentRates[priceKind];
  const expectedVersion = selectedRate?.locationId === locationId ? selectedRate.version : 0;
  useEffect(() => setCurrent(price || null), [price]);

  async function select(event) {
    const selection = event.target.value;
    if (!selection || busy) return;
    const expectedRateVersionId = currentRates[selection]?.id;
    setBusy(true);
    setMessage("");
    try {
      const result = await api(`/api/workorders/${encodeURIComponent(workorderId)}/modules/diagnosisRepair/actions/record`, {
        method: "POST",
        body: JSON.stringify({
          operation: "laborPriceSelection",
          selection,
          ...(expectedRateVersionId ? { expectedRateVersionId } : {}),
          reason: selection === "internal_cost" ? "Use configured internal labor cost" : "Use configured labor selling price",
          idempotencyKey: `labor-price-${crypto.randomUUID()}`,
        }),
      });
      setCurrent(result.result?.laborPrice || result.laborPrice || result.snapshot || null);
      try { await onChanged?.(); }
      catch { setMessage("Labor price selected. Refresh the workorder to update totals."); }
    } catch (error) {
      setMessage(error?.message || "Labor price could not be selected.");
    } finally {
      setBusy(false);
    }
  }

  async function setRate(event) {
    event.preventDefault();
    if (busy || !productId || !locationId || reason.trim().length < 2 || amount === "" || !currency.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/workorders/${encodeURIComponent(workorderId)}/modules/diagnosisRepair/actions/record`, {
        method: "POST",
        body: JSON.stringify({
          operation: "laborRateRevision",
          productId,
          locationId,
          priceKind,
          expectedVersion,
          amount,
          currency: currency.trim().toUpperCase(),
          reason: reason.trim(),
          idempotencyKey: `labor-rate-${crypto.randomUUID()}`,
        }),
      });
      setAmount("");
      setReason("");
      setRatesOpen(false);
      setMessage("Rate saved. Select a price source to apply it to this workorder.");
      try { await onChanged?.(); }
      catch { setMessage("Rate saved. Refresh the workorder, then select a price source."); }
    } catch (error) {
      setMessage(error?.message || "Labor rate could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const rateForm = <form onSubmit={setRate}>
    <label>Rate type<Dropdown aria-label="Rate type" value={priceKind} onChange={(event) => setPriceKind(event.target.value)} disabled={busy || disabled}><option value="internal_cost">Internal cost</option><option value="selling_price">Selling price</option></Dropdown></label>
    <small>Current local rate: {selectedRate?.status === "known" ? formatWorkorderMoney(selectedRate.amount, selectedRate.currency) : "Unknown"}</small>
    <label>Amount<input type="number" min="0" step="0.0001" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required disabled={busy || disabled} /></label>
    <label>Currency<input type="text" inputMode="text" maxLength={3} pattern="[A-Za-z]{3}" value={currency} onChange={(event) => setCurrency(event.target.value)} required disabled={busy || disabled} /></label>
    <label>Reason<input type="text" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} required disabled={busy || disabled} /></label>
    <footer><button type="button" onClick={() => setRatesOpen(false)} disabled={busy}>Cancel</button><button type="submit" disabled={busy || disabled || amount === "" || reason.trim().length < 2 || !/^[A-Za-z]{3}$/.test(currency)}>Save rate</button></footer>
    <small>Odoo prices are reference only. Enter the local rate you want to use.</small>
  </form>;

  if (compact) return <div className="used-part-field workorder-part-price workorder-labor-price is-compact">
    <span className="used-part-cell-label">Labor price</span>
    <div className="detail-inline-price-control">
      <span aria-hidden="true">{selectedPrice?.currency === "USD" || !selectedPrice?.currency ? "$" : selectedPrice.currency}</span>
      <input aria-label="Labor unit price" readOnly placeholder="Price" value={selectedPrice ? Number(selectedPrice.unitPrice).toFixed(2) : ""} />
      <Dropdown aria-label="Labor price source" className="detail-price-source-menu" placement="bottom end" value={selectedPrice?.selection || ""} onChange={select} disabled={busy || disabled || !productId || !(Number(hours) > 0)}>
        <option value="">Select price</option>
        <option value="internal_cost" disabled={currentRates.internal_cost?.status !== "known"}>Internal cost</option>
        <option value="selling_price" disabled={currentRates.selling_price?.status !== "known"}>Selling price</option>
      </Dropdown>
    </div>
    {productId ? <button className="workorder-set-rates-trigger" type="button" onClick={() => setRatesOpen(true)} disabled={busy || disabled}>Set rates</button> : null}
    {ratesOpen ? <ModalFrame overlayClassName="workorder-rate-overlay" modalClassName="workorder-rate-modal" dialogClassName="workorder-rate-dialog" ariaLabel="Set labor rates" isDismissable={!busy} onOpenChange={(open) => { if (!busy) setRatesOpen(open); }}>
      <header><h2>Set labor rates</h2><button type="button" onClick={() => setRatesOpen(false)} disabled={busy}>Close</button></header>
      {rateForm}
    </ModalFrame> : null}
    {message ? <small role={message.startsWith("Rate saved") || message.startsWith("Labor price selected") ? "status" : "alert"}>{message}</small> : null}
  </div>;

  return <div className="used-part-field workorder-part-price workorder-labor-price">
    <span className="used-part-cell-label">Labor price</span>
    <Dropdown aria-label="Labor price source" value={selectedPrice?.selection || ""} onChange={select} disabled={busy || disabled || !productId || !(Number(hours) > 0)}>
      <option value="">Select price</option>
      <option value="internal_cost" disabled={currentRates.internal_cost?.status !== "known"}>Internal cost</option>
      <option value="selling_price" disabled={currentRates.selling_price?.status !== "known"}>Selling price</option>
    </Dropdown>
    <div className="workorder-price-values">
      <span>Rate <strong>{formatWorkorderMoney(selectedPrice?.unitPrice, selectedPrice?.currency) || "Not selected"} / {uomCode === "ea" ? "service" : "hr"}</strong></span>
      <span>Line total <strong>{workorderLineTotal(selectedPrice, hours) || "Incomplete"}</strong></span>
    </div>
    {productId ? <details className="workorder-labor-rates" open={ratesOpen} onToggle={(event) => setRatesOpen(event.currentTarget.open)}>
      <summary>Set rates</summary>
      {rateForm}
    </details> : <small>Choose a labor product to set or select a rate.</small>}
    {message ? <small role={message.startsWith("Rate saved") || message.startsWith("Labor price selected") ? "status" : "alert"}>{message}</small> : null}
  </div>;
}
