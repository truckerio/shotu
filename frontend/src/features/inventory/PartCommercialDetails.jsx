import { CurrencySelector } from "../../components/forms/CurrencySelector.jsx";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { useEffect, useRef, useState } from "react";
import { RefreshCw01 } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { OperationalDataCell, OperationalDataRow, OperationalDataTable } from "../../components/ui/OperationalDataTable.jsx";
import { api } from "../../lib/api.js";
import { configuredPriceView, displayMoney, purchaseCoverageLabel, receiptCostBasisLabel, receiptDateBasisLabel } from "./part-commercial-model.js";
import "./part-commercial-details.css";

const newKey = (type) => `${type}-${crypto.randomUUID()}`;
const purchaseHistoryColumns = [
  { id: "date", label: "Date", isRowHeader: true },
  { id: "source", label: "Source" },
  { id: "quantity", label: "Quantity" },
  { id: "cost", label: "Unit cost" },
];
const purchaseOrderColumns = [
  { id: "date", label: "Date", isRowHeader: true },
  { id: "order", label: "Purchase order" },
  { id: "quantity", label: "Ordered / received" },
  { id: "cost", label: "Unit price" },
];

function batchPositionLabel(position) {
  if (position.systemKey === "receiving" || position.usage === "receiving") return "Receiving";
  if (position.systemKey === "unassigned" || position.usage === "unassigned") return "Unassigned";
  const code = String(position.code || "").trim();
  const name = String(position.name || "").trim();
  return code && name && code.toLocaleLowerCase() !== name.toLocaleLowerCase()
    ? `${code} · ${name}` : code || name || position.path || "Position";
}

function sellingPolicySummary(policy) {
  if (!policy) return "Not configured";
  if (policy.method === "markup_percent") return `${Number(policy.value)}% markup`;
  if (policy.method === "markup_amount") return `Add ${displayMoney(policy.value, policy.currency)}`;
  return displayMoney(policy.value, policy.currency);
}

function PriceHistory({ prices, locationScoped }) {
  const groups = locationScoped
    ? [["Location override", prices.override?.history || []], ["Company default", prices.companyDefault?.history || []]]
    : [["Company default", prices.history || []]];
  return groups.map(([label, history]) => <div className="inventory-commercial-history-group" key={label}><h6>{label}</h6>{history.length ? <ul>{history.map((price) => <li key={price.id}><strong>{configuredPriceView(price).label}</strong><span>Version {price.version} · {new Date(price.effectiveAt).toLocaleString()}</span><small>{price.reason}{price.createdBy?.name ? ` · ${price.createdBy.name}` : ""}</small></li>)}</ul> : <p>No saved history.</p>}</div>);
}

function SellingPolicyEditor({ policy, writeVersion = 0, disabled, observations, defaultCurrency, onSaved }) {
  const savedMethod = policy?.method || "fixed";
  const savedValue = policy?.value || "";
  const savedCurrency = policy?.currency || defaultCurrency || "";
  const [method, setMethod] = useState(savedMethod);
  const [value, setValue] = useState(savedValue);
  const [currency, setCurrency] = useState(savedCurrency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setMethod(savedMethod);
    setValue(savedValue);
    setCurrency(savedCurrency);
    setError("");
  }, [savedMethod, savedValue, savedCurrency]);
  const needsCurrency = method !== "markup_percent";
  const dirty = method !== savedMethod
    || String(value) !== String(savedValue)
    || (needsCurrency ? currency : "") !== (savedMethod !== "markup_percent" ? savedCurrency : "");
  const valid = String(value).trim() && (!needsCurrency || currency);
  const label = method === "fixed"
    ? "Fixed selling price"
    : method === "markup_percent" ? "Markup on batch cost (%)" : "Amount added to batch cost";
  const preview = valid ? (observations || [])
    .filter((entry) => entry.status === "known" || (entry.unitCost !== null && entry.currency))
    .slice(0, 3)
    .map((entry) => {
      const cost = Number(entry.unitCost);
      const adjustment = Number(value || 0);
      const amount = method === "fixed"
        ? adjustment
        : method === "markup_percent" ? cost * (1 + adjustment / 100) : cost + adjustment;
      return {
        ...entry,
        batchCurrency: entry.currency,
        selling: amount,
        sellingCurrency: method === "markup_percent" ? entry.currency : currency,
      };
    }) : [];

  async function save(event) {
    event.preventDefault();
    if (!dirty || !valid || busy || disabled) return;
    setBusy(true);
    setError("");
    try {
      await onSaved({
        expectedVersion: Number(writeVersion),
        method,
        value: String(value).trim(),
        currency: needsCurrency ? currency : null,
        reason: `Updated ${label.toLowerCase()}`,
        idempotencyKey: newKey("selling-policy"),
      });
    } catch (failure) {
      setError(failure.message || "Selling policy could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="inventory-commercial-price inventory-selling-policy" onSubmit={save}>
    <div className="inventory-commercial-price-fields">
      <label><span>Method</span><Dropdown value={method} onChange={(event) => setMethod(event.target.value)} disabled={busy || disabled}><option value="fixed">Same price for every batch</option><option value="markup_percent">Markup % on batch cost</option><option value="markup_amount">Add amount to batch cost</option></Dropdown></label>
      <label><span>{method === "markup_percent" ? "Markup %" : "Value"}</span><input inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} disabled={busy || disabled} /></label>
      {needsCurrency ? <label><span>Currency</span><CurrencySelector value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={busy || disabled} /></label> : <small>Uses each batch currency</small>}
      <Button type="submit" variant="primary" disabled={!dirty || !valid || busy || disabled}>{busy ? "Saving…" : "Save"}</Button>
    </div>
    {preview.length ? <div className="inventory-selling-preview"><strong>Batch preview</strong>{preview.map((entry) => <span key={entry.costLayerId || entry.receiptLineId}>{displayMoney(entry.unitCost, entry.batchCurrency)} cost → {displayMoney(String(entry.selling), entry.sellingCurrency)}</span>)}</div> : <small className="inventory-commercial-fallback">{valid ? "Add a priced batch to preview this policy." : "Enter a value to preview this policy."}</small>}
    {error ? <p role="alert">{error}</p> : null}
  </form>;
}

function BatchCostEditor({ batch, onCancel, onSaved }) {
  const [unitCost, setUnitCost] = useState(batch.unitCost || "");
  const [currency, setCurrency] = useState(batch.currency || "USD");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = /^\d{1,10}(?:\.\d{1,4})?$/.test(unitCost.trim()) && currency && reason.trim().length >= 2;

  async function save(event) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSaved(batch, {
        expectedVersion: Number(batch.costVersion || 0),
        unitCost: unitCost.trim(),
        currency,
        reason: reason.trim(),
        idempotencyKey: newKey("batch-cost"),
      });
    } catch (failure) {
      setError(failure.message || "Batch cost could not be saved.");
      setBusy(false);
    }
  }

  return <form className="inventory-batch-cost-editor" onSubmit={save}>
    <header><div><strong>Edit batch cost</strong><small>{batch.receiptReference || "Legacy stock"} · {batch.locationName}</small></div><Button type="button" onClick={onCancel} disabled={busy}>Cancel</Button></header>
    <div className="inventory-batch-cost-fields">
      <label><span>Unit cost</span><input inputMode="decimal" autoFocus value={unitCost} onChange={(event) => setUnitCost(event.target.value)} disabled={busy} /></label>
      <label><span>Currency</span><CurrencySelector value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={busy} /></label>
      <label><span>Reason</span><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength="500" placeholder="Why is this cost changing?" disabled={busy} /></label>
      <Button type="submit" variant="primary" disabled={!valid || busy}>{busy ? "Saving…" : "Save cost"}</Button>
    </div>
    <small>Only future pricing uses this correction. The source invoice and existing Workorder price snapshots stay unchanged.</small>
    {error ? <p role="alert">{error}</p> : null}
  </form>;
}

function BatchRow({ batch, locationScoped, canEditBatchCost, isNextToUse, onEdit }) {
  const batchName = batch.receiptReference || (batch.sourceKind === "receipt" ? "Receipt batch" : "Legacy stock");
  const receivedOn = batch.receivedAt ? new Date(batch.receivedAt).toLocaleDateString() : "Date unavailable";
  const placements = batch.placements?.length ? batch.placements : null;
  return <article className="inventory-batch-row">
    <div className="inventory-batch-row-heading"><div><span className="inventory-batch-row-title"><strong>{batchName}</strong>{isNextToUse ? <span className="inventory-batch-next">Next to use</span> : null}</span><small>{locationScoped ? "" : batch.locationName}</small></div><strong>{batch.availableQuantity} {batch.uomCode}</strong></div>
    <div className="inventory-batch-row-meta">
      <div><span>Stored at</span>{placements ? placements.map((position) => <strong key={position.positionId}>{batchPositionLabel(position)}{Number(position.reservedQuantity || 0) ? <small>{position.reservedQuantity} reserved</small> : null}</strong>) : <strong className="is-unresolved">Position not linked<small>Reconcile this legacy batch</small></strong>}</div>
      <div><span>Received</span><strong>{receivedOn}</strong></div>
    </div>
    {batch.placementStatus === "partial" ? <p className="inventory-batch-placement-warning">Some quantity is not assigned to a position.</p> : null}
    <footer><div><span>Cost</span><strong>{batch.unitCost === null ? "Unknown" : displayMoney(batch.unitCost, batch.currency)} / {batch.uomCode}</strong>{batch.unitCost === null ? <small className="is-unresolved">Cost not recorded</small> : batch.costReason ? <small>Corrected · {batch.costReason}</small> : null}</div>{Number(batch.reservedQuantity || 0) ? <small>{batch.reservedQuantity} reserved</small> : null}{canEditBatchCost ? <Button type="button" onClick={() => onEdit(batch)}>{batch.unitCost === null ? "Add cost" : "Edit cost"}</Button> : null}</footer>
  </article>;
}

export function PartCommercialDetails({ part, location = null, secondary = false, readOnly = false, manageableLocationIds = null, onChanged }) {
  const [details, setDetails] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [editingBatch, setEditingBatch] = useState(null);
  const sequence = useRef(0);
  const locationId = location?.locationId || location?.id || "";
  async function load({ preserveError = false } = {}) {
    if (!part?.catalogPartId) return;
    const request = ++sequence.current;
    setLoading(true);
    if (!preserveError) setError("");
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (locationId) params.set("locationId", locationId);
      const policyParams = locationId ? `?${new URLSearchParams({ locationId })}` : "";
      const [commercial, sellingPolicy] = await Promise.all([
        api(`/api/office/inventory/parts/${encodeURIComponent(part.catalogPartId)}/commercial?${params}`),
        api(`/api/office/inventory/parts/${encodeURIComponent(part.catalogPartId)}/selling-policy${policyParams}`),
      ]);
      if (request === sequence.current) {
        setDetails({ ...commercial, sellingPolicy });
        setError("");
      }
    } catch (failure) {
      if (request === sequence.current) setError(failure.message || "Cost and prices could not be loaded.");
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }
  useEffect(() => { setDetails(null); load(); return () => { sequence.current += 1; }; }, [part?.catalogPartId, locationId]);
  async function saveSellingPolicy(body) {
    const params = locationId ? `?${new URLSearchParams({ locationId })}` : "";
    await api(`/api/office/inventory/parts/${encodeURIComponent(part.catalogPartId)}/selling-policy${params}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    await load();
    onChanged?.();
  }
  async function saveBatchCost(batch, body) {
    await api(`/api/office/inventory/batches/${encodeURIComponent(batch.costLayerId)}/cost`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    setEditingBatch(null);
    await load();
    onChanged?.();
  }
  if (error && !details) return <div className="inventory-commercial-status" role="alert"><p>{error}</p><Button className="inventory-commercial-refresh" type="button" icon={RefreshCw01} onClick={() => load({ preserveError: true })} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</Button></div>;
  if (loading && !details) return <p className="inventory-commercial-status" role="status">Loading cost and prices…</p>;
  if (!details) return null;
  const costs = details.receiptCosts || details.purchaseCost || { observations: [], coverage: {} };
  const purchaseOrders = details.purchaseOrders || { observations: [] };
  const receiptLatest = costs.latest?.status === "known" ? costs.latest : null;
  const availableBatches = details.sellingPolicy?.availableBatches || [];
  const currentPricedBatch = availableBatches.find((batch) => Number(batch.availableQuantity) > 0 && batch.unitCost !== null && batch.currency) || null;
  const latest = receiptLatest || currentPricedBatch || purchaseOrders.latest || costs.latest;
  const latestLabel = receiptLatest || purchaseOrders.latest ? (receiptLatest ? "Latest purchase cost" : "Latest Odoo PO price") : "Latest purchase cost";
  const latestMeta = currentPricedBatch && !receiptLatest
    ? `${currentPricedBatch.receiptReference || "Legacy stock"} · ${currentPricedBatch.locationName}`
    : receiptLatest || !purchaseOrders.latest
      ? purchaseCoverageLabel(costs)
      : `${purchaseOrders.latest.orderNumber}${purchaseOrders.latest.vendorName ? ` · ${purchaseOrders.latest.vendorName}` : ""}`;
  const invoiceHref = (entry) => entry.source?.type === "invoice" && (entry.invoiceRunId || entry.source.id) ? `/?${new URLSearchParams({ adminView: "inventory", view: "inventory", invoiceRun: entry.invoiceRunId || entry.source.id })}` : "";
  const canEditSellingPolicy = !readOnly && details.sellingPolicy?.capabilities?.canEdit;
  const canEditBatchCost = !readOnly && details.sellingPolicy?.capabilities?.canEditBatchCost;
  const contents = <section className="inventory-commercial-details" aria-label={locationId ? `Batches at ${details.scope?.locationName || location?.locationName || "location"}` : "Batch costs and selling policy"}>
    {error ? <p className="inventory-commercial-status" role="alert">{error}</p> : null}
    {availableBatches.length ? <section className="inventory-batch-list" aria-label={`Batches (${availableBatches.length})`}><header><h3>Batches <span>{availableBatches.length}</span></h3></header>{availableBatches.map((batch, index) => <BatchRow key={batch.costLayerId} batch={batch} locationScoped={Boolean(locationId)} canEditBatchCost={canEditBatchCost && (!manageableLocationIds || manageableLocationIds.has(batch.locationId))} isNextToUse={index === 0} onEdit={setEditingBatch} />)}{editingBatch && canEditBatchCost && (!manageableLocationIds || manageableLocationIds.has(editingBatch.locationId)) ? <BatchCostEditor key={`${editingBatch.costLayerId}:${editingBatch.costVersion}`} batch={editingBatch} onCancel={() => setEditingBatch(null)} onSaved={saveBatchCost} /> : null}</section> : <p className="inventory-commercial-empty">No available batches for this {locationId ? "location" : "part"}.</p>}
    <details className="inventory-commercial-policy inventory-commercial-pricing-history">
      <summary><strong>Pricing &amp; history</strong><span>{sellingPolicySummary(details.sellingPolicy?.policy)}</span></summary>
      {canEditSellingPolicy ? <div className="inventory-commercial-editors"><h4>Selling policy</h4><SellingPolicyEditor policy={details.sellingPolicy?.policy} writeVersion={details.sellingPolicy?.writeVersion} observations={availableBatches} defaultCurrency={latest?.currency||""} onSaved={saveSellingPolicy}/></div> : null}
      {purchaseOrders.observations?.length ? <details className="inventory-commercial-history"><summary>Odoo purchase orders</summary><OperationalDataTable ariaLabel="Odoo purchase orders" columns={purchaseOrderColumns} className="inventory-commercial-history-table">{purchaseOrders.observations.map((entry) => <OperationalDataRow id={entry.lineId} key={entry.lineId}><OperationalDataCell label="Date"><span>{entry.approvedAt || entry.orderedAt ? new Date(entry.approvedAt || entry.orderedAt).toLocaleDateString() : "Unknown"}</span><small>{entry.status || "Purchased"}</small></OperationalDataCell><OperationalDataCell label="Purchase order"><strong>{entry.orderNumber || "Odoo PO"}</strong><small>{entry.vendorName || "Vendor not recorded"}</small></OperationalDataCell><OperationalDataCell label="Ordered / received"><span>{entry.quantity ?? "—"} {entry.uomCode}</span><small>{entry.receivedQuantity ?? "—"} received</small></OperationalDataCell><OperationalDataCell label="Unit price"><strong>{displayMoney(entry.unitCost, entry.currency)}</strong><small>{entry.currency || "Currency unavailable"}</small></OperationalDataCell></OperationalDataRow>)}</OperationalDataTable>{purchaseOrders.truncated ? <p>Showing the 50 most recent Odoo purchase lines.</p> : null}</details> : null}
      {costs.observations?.length ? <details className="inventory-commercial-history"><summary>Purchase history</summary><OperationalDataTable ariaLabel="Purchase history" columns={purchaseHistoryColumns} className="inventory-commercial-history-table">{costs.observations.map((entry) => { const href = invoiceHref(entry), sourceName = entry.invoice?.invoiceNumber || entry.source?.invoiceNumber || entry.invoice?.vendorName || entry.source?.vendorName || String(entry.source?.type || "receipt").replaceAll("_", " "); return <OperationalDataRow id={entry.receiptLineId} key={entry.receiptLineId}><OperationalDataCell label="Date"><span>{entry.occurredOn ? new Date(entry.occurredOn).toLocaleDateString() : "Unknown"}</span><small>{receiptDateBasisLabel(entry)}</small></OperationalDataCell><OperationalDataCell label="Source"><span>{href ? <a href={href}>{sourceName}</a> : sourceName}</span><small>{receiptCostBasisLabel(entry)}</small></OperationalDataCell><OperationalDataCell label="Quantity">{entry.quantity} {entry.uomCode}</OperationalDataCell><OperationalDataCell label="Unit cost"><strong>{displayMoney(entry.unitCost, entry.currency)}</strong><small>{entry.status === "known" ? "Known cost" : "Unknown cost"}</small></OperationalDataCell></OperationalDataRow>; })}</OperationalDataTable>{costs.truncated ? <p>Showing the 50 most recent receipt lines.</p> : null}</details> : <p className="inventory-commercial-empty">No purchase cost recorded for this {locationId ? "location" : "part"}.</p>}
      <details className="inventory-commercial-configured-history"><summary>Legacy price history</summary><section><h5>Selling price</h5><PriceHistory prices={details.prices.selling} locationScoped={Boolean(locationId)} /></section></details>
    </details>
  </section>;
  return secondary ? <details className="inventory-commercial-secondary"><summary>Company price defaults</summary>{contents}</details> : contents;
}
