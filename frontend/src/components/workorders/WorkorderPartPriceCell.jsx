import { useCallback, useEffect, useRef, useState } from "react";
import { WorkorderUnitPriceInput } from "./WorkorderUnitPriceInput.jsx";
import { PriceSourceDropdown } from "./PriceSourceDropdown.jsx";
import { PartRatesDialog } from "../pricing/PartRatesDialog.jsx";
import { api } from "../../lib/api.js";
import { formatWorkorderMoney, workorderLineTotal } from "./workorder-pricing-model.js";

function money(value, currency) {
  if (value === null || value === undefined || !currency) return "Not selected";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 4,
    }).format(Number(value));
  } catch {
    return `${value} ${currency}`;
  }
}

function allocationMoney(value, currency) {
  return value === null || value === undefined || !currency ? "Unknown cost" : money(value, currency);
}

function currencyPrefix(price) {
  if (!price?.currency || price.currency === "USD") return "$";
  return price.currency;
}

export function WorkorderPartPriceCell({
  workorderId,
  usageKind,
  usageId,
  noStockLineId,
  catalogPartId,
  partLabel,
  locationId,
  uomCode,
  price,
  quantity,
  onChanged,
  disabled = false,
  batchCostAvailable = true,
  costAllocations = [],
  compact = false,
}) {
  const [current, setCurrent] = useState(price || null);
  const [busy, setBusy] = useState(false);
  const pendingPriceCommand = useRef(null);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState(null);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [needsPriceSelection, setNeedsPriceSelection] = useState(false);
  const previewGeneration = useRef(0);
  useEffect(() => setCurrent(price || null), [price]);
  const loadOptions = useCallback(async () => {
    const generation = ++previewGeneration.current;
    if (disabled) { setPreview(null); setMessage(""); return; }
    try {
      const result = await api(`/api/workorders/${encodeURIComponent(workorderId)}/modules/parts/actions/record`, {
        method: "POST",
        body: JSON.stringify({ operation: "partPricingPreview", usageKind,
          ...(usageKind === "no_stock" ? { noStockLineId } : { usageId }) }),
      });
      if (generation === previewGeneration.current) { setPreview(result.result || result); setMessage(""); }
    } catch (error) {
      if (generation === previewGeneration.current) { setPreview(null); setMessage(error?.message || "Prices could not be loaded."); }
    }
  }, [workorderId, usageKind, usageId, noStockLineId, disabled]);
  useEffect(() => { setPreview(null); void loadOptions(); return () => { previewGeneration.current += 1; }; }, [loadOptions, price]);
  const visibleAllocations = costAllocations.length ? costAllocations : (current?.allocations || []);
  const allocationCurrencies = new Set(visibleAllocations.map((allocation) => allocation.currency).filter(Boolean));
  const hasKnownAllocationCosts = visibleAllocations.length > 0
    && visibleAllocations.every((allocation) => (allocation.unitPrice ?? allocation.unitCost) !== null && allocation.currency)
    && allocationCurrencies.size === 1;
  const canUseBatchCost = usageKind === "no_stock" ? false : usageKind === "serialized"
    ? batchCostAvailable
    : batchCostAvailable && hasKnownAllocationCosts;
  const allocationTotal = hasKnownAllocationCosts
    ? visibleAllocations.reduce((total, allocation) => {
      const unitCost = Number(allocation.unitCost ?? allocation.unitPrice);
      const lineTotal = allocation.totalCost ?? allocation.totalPrice;
      return total + (lineTotal === null || lineTotal === undefined
        ? Number(allocation.quantity) * unitCost
        : Number(lineTotal));
    }, 0)
    : null;
  const allocationCurrency = allocationCurrencies.size === 1 ? [...allocationCurrencies][0] : "";

  async function select(event, customUnitPrice) {
    const selection = event.target.value;
    if (!selection || busy || disabled || !preview?.fingerprint) return;
    setBusy(true);
    setMessage("");
    try {
      const command = {
        operation: "partPriceSelection", usageKind,
        ...(usageKind === "no_stock" ? { noStockLineId } : { usageId }),
        selection,
        ...(customUnitPrice !== undefined ? { customUnitPrice } : {}),
        expectedFingerprint: preview.fingerprint,
        reason: customUnitPrice !== undefined ? "Manually entered Workorder unit price" : selection === "batch_cost"
          ? "Use exact receipt batch cost"
          : selection === "internal_cost" ? "Use configured internal cost" : "Use configured selling policy",
      };
      const signature = JSON.stringify({ workorderId, ...command });
      if (pendingPriceCommand.current?.signature !== signature) {
        pendingPriceCommand.current = { signature, body: { ...command, idempotencyKey: `part-price-${crypto.randomUUID()}` } };
      }
      const result = await api(`/api/workorders/${encodeURIComponent(workorderId)}/modules/parts/actions/record`, {
        method: "POST",
        body: JSON.stringify(pendingPriceCommand.current.body),
      });
      pendingPriceCommand.current = null;
      setCurrent(result.result?.snapshot || result.snapshot);
      setNeedsPriceSelection(false);
      try { await onChanged?.(); }
      catch { setMessage("Price saved. Refresh the workorder to update totals and activity."); }
    } catch (error) {
      setMessage(error?.message || "Price could not be selected.");
    } finally {
      setBusy(false);
    }
  }

  const ratePartId = catalogPartId || preview?.catalogPartId || preview?.part?.catalogPartId;
  const selector = <PriceSourceDropdown
    aria-label="Price source"
    className={compact ? "detail-price-source-menu" : undefined}
    value={needsPriceSelection ? "" : current?.selection || ""}
    options={preview?.options || {}}
    includeBatch={usageKind !== "no_stock"}
    onChange={select}
    onSetRates={ratePartId && !disabled ? () => setRatesOpen(true) : undefined}
    disabled={busy || disabled}
  />;
  const ratesDialog = ratesOpen ? <PartRatesDialog open catalogPartId={ratePartId}
    locationId={locationId || preview?.locationId} partLabel={partLabel || preview?.partNumber || "Part"}
    uomCode={uomCode || preview?.uomCode} onClose={() => setRatesOpen(false)}
    onSaved={async () => { setNeedsPriceSelection(true); await loadOptions(); setMessage("Rates saved. Choose a price source to apply them to this workorder."); try { await onChanged?.(); } catch { setMessage("Rates saved. Refresh the workorder before choosing its price."); } }} /> : null;
  const allocationHistory = visibleAllocations.length ? <details className="workorder-part-price-layers">
    <summary>FCFS · {visibleAllocations.length} {visibleAllocations.length === 1 ? "batch" : "batches"}{allocationTotal === null ? "" : ` · ${money(allocationTotal, allocationCurrency)} total`}</summary>
    <ul>{visibleAllocations.map((allocation) => {
      const amount = allocation.unitPrice ?? allocation.unitCost;
      const recordedTotal = allocation.totalCost ?? allocation.totalPrice;
      const lineTotal = recordedTotal ?? (amount === null || amount === undefined
        ? null
        : Number(allocation.quantity) * Number(amount));
      return <li key={allocation.costLayerId}>
        <span><strong>{allocation.quantity} × {allocationMoney(amount, allocation.currency)}</strong><strong>{allocationMoney(lineTotal, allocation.currency)}</strong></span>
        <small>{allocation.receiptReference || (allocation.sourceKind === "receipt" ? "Receipt batch" : "Legacy cost unavailable")}</small>
      </li>;
    })}</ul>
  </details> : null;

  const priceInput = <WorkorderUnitPriceInput label="Part unit price" price={current}
    disabled={busy || disabled || !preview?.fingerprint || needsPriceSelection}
    onCommit={(value) => select({ target: { value: current?.selection } }, value)} />;

  if (compact) return <div className="used-part-field workorder-part-price is-compact">
    <span className="used-part-cell-label">Price</span>
    <div className="detail-inline-price-control">
      <span aria-hidden="true">{currencyPrefix(current)}</span>
      {priceInput}
      {selector}
    </div>
    {allocationHistory}
    {ratesDialog}
    {message ? <small role="alert">{message}</small> : null}
  </div>;

  return (
    <div className="used-part-field workorder-part-price">
      <span className="used-part-cell-label">Price</span>
      <div className="detail-inline-price-control"><span aria-hidden="true">{currencyPrefix(current)}</span>{priceInput}{selector}</div>
      <div className="workorder-price-values">
        <span>Unit price <strong>{current?.selection ? formatWorkorderMoney(current.unitPrice, current.currency) || "Unknown" : "Not selected"}</strong></span>
        <span>Line total <strong>{workorderLineTotal(current, quantity) || "Incomplete"}</strong></span>
      </div>
      {allocationHistory}
      {ratesDialog}
      {message ? <small role="alert">{message}</small> : null}
    </div>
  );
}
