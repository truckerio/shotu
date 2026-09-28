import { useEffect, useState } from "react";
import { Dropdown } from "../forms/Dropdown.jsx";
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

export function WorkorderPartPriceCell({
  workorderId,
  usageKind,
  usageId,
  price,
  quantity,
  onChanged,
  disabled = false,
  batchCostAvailable = true,
  costAllocations = [],
}) {
  const [current, setCurrent] = useState(price || null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => setCurrent(price || null), [price]);
  const visibleAllocations = costAllocations.length ? costAllocations : (current?.allocations || []);
  const allocationCurrencies = new Set(visibleAllocations.map((allocation) => allocation.currency).filter(Boolean));
  const hasKnownAllocationCosts = visibleAllocations.length > 0
    && visibleAllocations.every((allocation) => (allocation.unitPrice ?? allocation.unitCost) !== null && allocation.currency)
    && allocationCurrencies.size === 1;
  const canUseBatchCost = usageKind === "serialized"
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

  async function select(event) {
    const selection = event.target.value;
    if (!selection || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api(
        `/api/workorders/${encodeURIComponent(workorderId)}/modules/parts/actions/record`,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "partPriceSelection",
            usageKind,
            usageId,
            selection,
            reason: selection === "batch_cost"
              ? "Use exact receipt batch cost"
              : "Use configured selling policy",
            idempotencyKey: `part-price-${crypto.randomUUID()}`,
          }),
        },
      );
      setCurrent(result.snapshot);
      await onChanged?.();
    } catch (error) {
      setMessage(error?.message || "Price could not be selected.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="used-part-field workorder-part-price">
      <span className="used-part-cell-label">Price</span>
      <Dropdown
        aria-label="Price source"
        value={current?.selection || ""}
        onChange={select}
        disabled={busy || disabled}
      >
        <option value="">Select price</option>
        <option value="batch_cost" disabled={!canUseBatchCost}>
          Batch cost{canUseBatchCost ? "" : " — cost unavailable"}
        </option>
        <option value="selling_price">Selling price</option>
      </Dropdown>
      <div className="workorder-price-values">
        <span>Unit price <strong>{current?.selection ? formatWorkorderMoney(current.unitPrice, current.currency) || "Unknown" : "Not selected"}</strong></span>
        <span>Line total <strong>{workorderLineTotal(current, quantity) || "Incomplete"}</strong></span>
      </div>
      {visibleAllocations.length ? <details className="workorder-part-price-layers">
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
      </details> : null}
      {message ? <small role="alert">{message}</small> : null}
    </div>
  );
}
