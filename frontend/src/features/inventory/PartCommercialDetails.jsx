import { CurrencySelector } from "../../components/forms/CurrencySelector.jsx";
import { useEffect, useRef, useState } from "react";
import { RefreshCw01 } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { OperationalDataCell, OperationalDataRow, OperationalDataTable } from "../../components/ui/OperationalDataTable.jsx";
import { api } from "../../lib/api.js";
import { configuredPriceView, displayMoney, locationPriceEditState, pricePayload, priceSourceLabel, purchaseCoverageLabel, receiptCostBasisLabel, receiptDateBasisLabel } from "./part-commercial-model.js";
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

function PriceEditor({ kind, label, current, editCurrent = current, expectedVersion, source, companyDefault, providerPrice, disabled, defaultCurrency, uomCode, onSaved }) {
  const editView = configuredPriceView(editCurrent);
  const savedAmount = editCurrent?.amount ?? "";
  const savedCurrency = editCurrent?.currency || defaultCurrency || "";
  const [amount, setAmount] = useState(savedAmount), [currency, setCurrency] = useState(savedCurrency), [key, setKey] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { setAmount(savedAmount); setCurrency(savedCurrency); setKey(""); }, [savedAmount, savedCurrency]);
  const draft = { amount, currency, taxTreatment: "not_configured", taxProfileVersionId: null };
  const dirty = String(amount) !== String(savedAmount) || currency !== savedCurrency;
  const valid = !String(amount).trim() || Boolean(currency);
  const revise = (setter, value) => { setter(value); setKey(newKey(`part-price-${kind}`)); };
  async function save() {
    if (!dirty || !valid || busy || disabled) return;
    const reason = String(amount).trim() ? `Updated ${label.toLowerCase()}` : `Cleared ${label.toLowerCase()}`;
    setBusy(true); setError("");
    try { await onSaved(kind, pricePayload({ ...draft, reason, expectedVersion: expectedVersion ?? editView.version, idempotencyKey: key || newKey(`part-price-${kind}`) })); setKey(""); }
    catch (failure) { setError(failure.message || "Price could not be saved."); }
    finally { setBusy(false); }
  }
  return <form className="inventory-commercial-price" onSubmit={(event) => { event.preventDefault(); save(); }}>
    <div className="inventory-commercial-price-heading"><strong>{label}</strong>{source ? <small className="inventory-commercial-source">{priceSourceLabel(source)}</small> : null}</div>
    <div className="inventory-commercial-price-fields">
      <label><span>Amount</span><input inputMode="decimal" aria-label={`${label} amount`} placeholder="Unknown" value={amount} onChange={(event) => revise(setAmount, event.target.value)} disabled={busy || disabled} /></label>
      <label><span>Currency</span><CurrencySelector value={currency} onChange={(event) => revise(setCurrency, event.target.value)} disabled={busy || disabled || !String(amount).trim()} /></label>
      <small>per {uomCode || "unit"}</small>
      <Button type="submit" variant="primary" disabled={!dirty || !valid || busy || disabled}>{busy ? "Saving…" : "Save"}</Button>
    </div>
    {source === "location_override" && companyDefault ? <small className="inventory-commercial-fallback">Company default: {configuredPriceView(companyDefault).label}</small> : null}
    {providerPrice?.status === "known" ? <small className="inventory-commercial-fallback">Odoo reference: {displayMoney(providerPrice.amount, providerPrice.currency)} per {uomCode || "unit"}</small> : null}
    {error ? <p role="alert">{error}</p> : null}
  </form>;
}

function PriceHistory({ prices, locationScoped }) {
  const groups = locationScoped
    ? [["Location override", prices.override?.history || []], ["Company default", prices.companyDefault?.history || []]]
    : [["Company default", prices.history || []]];
  return groups.map(([label, history]) => <div className="inventory-commercial-history-group" key={label}><h6>{label}</h6>{history.length ? <ul>{history.map((price) => <li key={price.id}><strong>{configuredPriceView(price).label}</strong><span>Version {price.version} · {new Date(price.effectiveAt).toLocaleString()}</span><small>{price.reason}{price.createdBy?.name ? ` · ${price.createdBy.name}` : ""}</small></li>)}</ul> : <p>No saved history.</p>}</div>);
}

export function PartCommercialDetails({ part, location = null, secondary = false, onChanged }) {
  const [details, setDetails] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const locationId = location?.locationId || location?.id || "";
  async function load({ preserveError = false } = {}) { if (!part?.catalogPartId) return; const request = ++sequence.current; setLoading(true); if (!preserveError) setError(""); try { const params = new URLSearchParams({ limit: "50" }); if (locationId) params.set("locationId", locationId); const commercial = await api(`/api/office/inventory/parts/${encodeURIComponent(part.catalogPartId)}/commercial?${params}`); if (request === sequence.current) { setDetails(commercial); setError(""); } } catch (failure) { if (request === sequence.current) setError(failure.message || "Cost and prices could not be loaded."); } finally { if (request === sequence.current) setLoading(false); } }
  useEffect(() => { setDetails(null); load(); return () => { sequence.current += 1; }; }, [part?.catalogPartId, locationId]);
  async function savePrice(kind, body) { const scope = locationId ? `/locations/${encodeURIComponent(locationId)}` : ""; await api(`/api/office/inventory/parts/${encodeURIComponent(part.catalogPartId)}${scope}/prices/${kind}`, { method: "PUT", body: JSON.stringify(body) }); await load(); onChanged?.(); }
  if (error && !details) return <div className="inventory-commercial-status" role="alert"><p>{error}</p><Button className="inventory-commercial-refresh" type="button" icon={RefreshCw01} onClick={() => load({ preserveError: true })} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</Button></div>;
  if (loading && !details) return <p className="inventory-commercial-status" role="status">Loading cost and prices…</p>;
  if (!details) return null;
  const costs = details.receiptCosts || details.purchaseCost || { observations: [], coverage: {} };
  const purchaseOrders = details.purchaseOrders || { observations: [] };
  const receiptLatest = costs.latest?.status === "known" ? costs.latest : null;
  const latest = receiptLatest || purchaseOrders.latest || costs.latest;
  const invoiceHref = (entry) => entry.source?.type === "invoice" && (entry.invoiceRunId || entry.source.id) ? `/?${new URLSearchParams({ adminView: "inventory", view: "inventory", invoiceRun: entry.invoiceRunId || entry.source.id })}` : "";
  const editor = (kind, label) => { const projection = details.prices[kind], state = locationId ? locationPriceEditState(projection) : { draft: projection.current, expectedVersion: configuredPriceView(projection.current).version, effective: projection.current, companyDefault: null, source: null }; const providerPrice = details.odooPrices?.[kind] || null; return <PriceEditor key={kind} kind={kind} label={label} current={state.effective} editCurrent={state.draft} expectedVersion={state.expectedVersion} source={locationId ? state.source : null} companyDefault={state.companyDefault} providerPrice={providerPrice} disabled={!details.capabilities.canEditPrices} defaultCurrency={latest?.currency || providerPrice?.currency || ""} uomCode={part.uomCode} onSaved={savePrice} />; };
  const contents = <section className="inventory-commercial-details" aria-label={locationId ? `Prices for ${details.scope?.locationName || location?.locationName || "location"}` : "Company price defaults"}>
    {error ? <p className="inventory-commercial-status" role="alert">{error}</p> : null}
    {locationId ? <p className="inventory-commercial-scope">{details.scope?.locationName || location?.locationName}</p> : null}
    <div className="inventory-commercial-editors">{editor("selling", "Selling price")}{editor("internal", "Internal price")}</div>
    <div className="inventory-commercial-purchase"><div><span>{receiptLatest || !purchaseOrders.latest ? "Latest purchase cost" : "Latest Odoo PO price"}</span><strong>{latest ? displayMoney(latest.unitCost, latest.currency) : "Unknown"}</strong></div><small>{receiptLatest || !purchaseOrders.latest ? purchaseCoverageLabel(costs) : `${purchaseOrders.latest.orderNumber}${purchaseOrders.latest.vendorName ? ` · ${purchaseOrders.latest.vendorName}` : ""}`} · per {part.uomCode || "unit"}</small></div>
    {purchaseOrders.observations?.length ? <details className="inventory-commercial-history"><summary>Odoo purchase orders</summary><OperationalDataTable ariaLabel="Odoo purchase orders" columns={purchaseOrderColumns} className="inventory-commercial-history-table">{purchaseOrders.observations.map((entry) => <OperationalDataRow id={entry.lineId} key={entry.lineId}><OperationalDataCell label="Date"><span>{entry.approvedAt || entry.orderedAt ? new Date(entry.approvedAt || entry.orderedAt).toLocaleDateString() : "Unknown"}</span><small>{entry.status || "Purchased"}</small></OperationalDataCell><OperationalDataCell label="Purchase order"><strong>{entry.orderNumber || "Odoo PO"}</strong><small>{entry.vendorName || "Vendor not recorded"}</small></OperationalDataCell><OperationalDataCell label="Ordered / received"><span>{entry.quantity ?? "—"} {entry.uomCode}</span><small>{entry.receivedQuantity ?? "—"} received</small></OperationalDataCell><OperationalDataCell label="Unit price"><strong>{displayMoney(entry.unitCost, entry.currency)}</strong><small>{entry.currency || "Currency unavailable"}</small></OperationalDataCell></OperationalDataRow>)}</OperationalDataTable>{purchaseOrders.truncated ? <p>Showing the 50 most recent Odoo purchase lines.</p> : null}</details> : null}
    {costs.observations?.length ? <details className="inventory-commercial-history"><summary>Purchase history</summary><OperationalDataTable ariaLabel="Purchase history" columns={purchaseHistoryColumns} className="inventory-commercial-history-table">{costs.observations.map((entry) => { const href = invoiceHref(entry), sourceName = entry.invoice?.invoiceNumber || entry.source?.invoiceNumber || entry.invoice?.vendorName || entry.source?.vendorName || String(entry.source?.type || "receipt").replaceAll("_", " "); return <OperationalDataRow id={entry.receiptLineId} key={entry.receiptLineId}><OperationalDataCell label="Date"><span>{entry.occurredOn ? new Date(entry.occurredOn).toLocaleDateString() : "Unknown"}</span><small>{receiptDateBasisLabel(entry)}</small></OperationalDataCell><OperationalDataCell label="Source"><span>{href ? <a href={href}>{sourceName}</a> : sourceName}</span><small>{receiptCostBasisLabel(entry)}</small></OperationalDataCell><OperationalDataCell label="Quantity">{entry.quantity} {entry.uomCode}</OperationalDataCell><OperationalDataCell label="Unit cost"><strong>{displayMoney(entry.unitCost, entry.currency)}</strong><small>{entry.status === "known" ? "Known cost" : "Unknown cost"}</small></OperationalDataCell></OperationalDataRow>; })}</OperationalDataTable>{costs.truncated ? <p>Showing the 50 most recent receipt lines.</p> : null}</details> : <p className="inventory-commercial-empty">No purchase cost recorded for this {locationId ? "location" : "part"}.</p>}
    <details className="inventory-commercial-configured-history"><summary>Price history</summary>{["selling", "internal"].map((kind) => <section key={kind}><h5>{kind === "internal" ? "Internal price" : "Selling price"}</h5><PriceHistory prices={details.prices[kind]} locationScoped={Boolean(locationId)} /></section>)}</details>
  </section>;
  return secondary ? <details className="inventory-commercial-secondary"><summary>Company price defaults</summary>{contents}</details> : contents;
}
