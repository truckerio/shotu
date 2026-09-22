import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button.jsx";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { OperationalDataCell, OperationalDataRow, OperationalDataTable } from "../../components/ui/OperationalDataTable.jsx";
import { SecondaryDetailPanel, SecondaryDetailSection } from "../../components/ui/SecondaryDetailPanel.jsx";
import { OperationalCollectionTabs, OperationalCollectionToolbar } from "../../components/operations/OperationalCollectionPage.jsx";
import { api } from "../../lib/api.js";
import { DirectReceiptApprovalDetail } from "./DirectReceiptApprovalDetail.jsx";
import { INBOUND_VIEWS, inboundAction, inboundActionLabel, inboundCount, inboundProgress, inboundReference, inboundRequestUrl, inboundStatus } from "./inventory-inbound-model.js";

const columns = [{ id: "inbound", label: "Inbound", isRowHeader: true }, { id: "status", label: "Status" }, { id: "next", label: "Next" }];
const number = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export function InventoryInboundWorkspace({ locations, onOpenInvoice, onReceivePurchaseOrder, onAddInventory, onUploadInvoice, initialReceiptId = "", initialDeliveryId = "" }) {
  const [view, setView] = useState("my_work");
  const [locationId, setLocationId] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], invoices: [], counts: {}, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [consumedSourceId, setConsumedSourceId] = useState("");
  const [approvalId, setApprovalId] = useState(() => new URLSearchParams(window.location.search).get("approvalId") || "");

  useEffect(() => { setPage(1); }, [view, locationId, query]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    const timer = window.setTimeout(() => {
      api(inboundRequestUrl({ view, locationId, query, page }))
        .then((value) => { if (active) {
          const items = value.items || [];
          setData({ items, counts: value.counts || {}, hasMore: !!value.hasMore });
          setSelectedId((current) => items.some((item) => item.id === current) ? current : "");
        } })
        .catch((cause) => { if (active) setError(cause.message || "Inbound work could not be loaded."); })
        .finally(() => { if (active) setLoading(false); });
    }, query ? 180 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [view, locationId, query, page, retry]);

  const initialSourceId = initialReceiptId || initialDeliveryId;
  useEffect(() => {
    if (!initialSourceId || approvalId || consumedSourceId === initialSourceId) return undefined;
    let active = true;
    api(`/api/office/inventory/inbound/${encodeURIComponent(initialSourceId)}`)
      .then((result) => { if (active) { if (result.item) { setSelectedDetail(result.item); setSelectedId(result.item.id); } setConsumedSourceId(initialSourceId); } })
      .catch(() => { if (active) setConsumedSourceId(initialSourceId); /* A closed or missing source falls back to the normal inbound list. */ });
    return () => { active = false; };
  }, [approvalId, consumedSourceId, initialSourceId]);

  const selected = useMemo(() => selectedDetail || data.items.find((item) => item.id === selectedId) || null, [data.items, selectedDetail, selectedId]);
  function runAction(item) {
    const action = inboundAction(item);
    if (action?.id === "invoice") onOpenInvoice?.(item.invoiceRunId, item.locationId);
    if (action?.id === "purchase_order") onReceivePurchaseOrder?.(item.poId, item.locationId);
    if (action?.id === "inventory") onAddInventory?.(item.locationId);
    if (action?.id === "invoice_upload") onUploadInvoice?.(item.locationId);
  }
  const action = selected ? inboundAction(selected) : null;
  if (approvalId) return <DirectReceiptApprovalDetail approvalId={approvalId} onClose={() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("approvalId");
    window.history.replaceState({}, "", url);
    setApprovalId("");
  }} />;
  return <section className="inventory-inbound-workspace">
    <OperationalCollectionTabs ariaLabel="Inbound views" activeId={view} onChange={setView} items={INBOUND_VIEWS.map((item) => ({ ...item, count: inboundCount(data.counts, item.id), countLabel: `${inboundCount(data.counts, item.id)} inbound items` }))} />
    <OperationalCollectionToolbar className="inventory-inbound-toolbar">
      <label><span>Shop</span><Dropdown aria-label="Inbound shop" value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">All shops</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</Dropdown></label>
      <label><span>Search</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="PO, supplier, invoice" aria-label="Search inbound work" /></label>
    </OperationalCollectionToolbar>
    {error ? <div className="inventory-inbound-error" role="alert"><span>{error}</span><Button onClick={() => setRetry((value) => value + 1)}>Retry</Button></div> : null}
    {loading ? <p className="inventory-inbound-loading" role="status">Loading inbound work…</p> : null}
    {!loading && !error && !data.items.length ? <p className="inventory-inbound-empty">No inbound work matches this view.</p> : null}
    {!loading && data.items.length ? <OperationalDataTable ariaLabel="Inbound work" columns={columns} className="inventory-data-table inventory-inbound-table">{data.items.map((item) => <OperationalDataRow id={item.id} key={item.id}>
      <OperationalDataCell label="Inbound"><button type="button" className="inventory-inbound-open" onClick={() => { setSelectedDetail(item); setSelectedId(item.id); }}><strong>{item.supplier || "Supplier not set"}</strong><span>{item.locationName || "Shop not set"} · {inboundReference(item)}</span><small>{item.invoiceCount > 1 ? `${item.invoiceCount} invoices` : item.invoiceNumber ? `Invoice ${item.invoiceNumber}` : "No invoice"}</small></button></OperationalDataCell>
      <OperationalDataCell label="Status"><strong>{inboundStatus(item)}</strong><small>{item.invoiceStatus ? inboundProgress(item) : `${number(item.heldQuantity)} held · ${number(item.rejectedQuantity)} rejected · ${number(item.shortQuantity)} short`}</small></OperationalDataCell>
      <OperationalDataCell label="Next"><button type="button" className="inventory-inbound-open" onClick={() => { setSelectedDetail(item); setSelectedId(item.id); }}><strong>{inboundActionLabel(item.nextAction)}</strong><small>{item.ownerLabel || "Unassigned"}</small></button></OperationalDataCell>
    </OperationalDataRow>)}</OperationalDataTable> : null}
    {!loading && !error && (page > 1 || data.hasMore) ? <nav className="inventory-inbound-pagination" aria-label="Inbound pages"><Button disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><span>Page {page}</span><Button disabled={!data.hasMore} onClick={() => setPage((value) => value + 1)}>Next</Button></nav> : null}
    <SecondaryDetailPanel open={!!selected} onOpenChange={(open) => { if (!open) { const url = new URL(window.location.href); url.searchParams.delete("receiptId"); url.searchParams.delete("deliveryId"); window.history.replaceState({}, "", url); setSelectedId(""); setSelectedDetail(null); } }} eyebrow="Inbound" title={selected?.supplier || "Inbound work"} description={selected ? `${selected.locationName || "Shop not set"} · ${inboundReference(selected)}` : ""}>
      {selected ? <div className="inventory-inbound-detail">{selected.invoiceStatus ? <SecondaryDetailSection title="Invoice status"><dl className="inventory-detail-facts"><div><dt>Status</dt><dd>{inboundStatus(selected)}</dd></div><div><dt>Invoice</dt><dd>{selected.invoiceNumber || "Not identified"}</dd></div><div><dt>Shop</dt><dd>{selected.locationName || "Shop not set"}</dd></div><div><dt>Owner</dt><dd>{selected.ownerLabel || "Invoice intake"}</dd></div></dl></SecondaryDetailSection> : <><SecondaryDetailSection title="Receipt progress">{selected.uomCodes?.length > 1 ? <dl className="inventory-detail-facts"><div><dt>Units</dt><dd>{selected.uomCodes.join(", ")}</dd></div></dl> : <dl className="inventory-detail-facts"><div><dt>Expected</dt><dd>{number(selected.expectedQuantity)}</dd></div><div><dt>Received</dt><dd>{number(selected.receivedQuantity)}</dd></div><div><dt>Remaining</dt><dd>{number(selected.remainingQuantity)}</dd></div><div><dt>Held</dt><dd>{number(selected.heldQuantity)}</dd></div><div><dt>Rejected</dt><dd>{number(selected.rejectedQuantity)}</dd></div><div><dt>Short</dt><dd>{number(selected.shortQuantity)}</dd></div></dl>}</SecondaryDetailSection>{selected.selectedDelivery ? <SecondaryDetailSection title="Selected delivery"><dl className="inventory-detail-facts"><div><dt>Reference</dt><dd>{selected.selectedDelivery.reference || selected.selectedDelivery.id}</dd></div><div><dt>Received by</dt><dd>{selected.selectedDelivery.receivedBy?.displayName || "Team member"}</dd></div><div><dt>Received</dt><dd>{number(selected.selectedDelivery.actualQuantity)}</dd></div><div><dt>Held</dt><dd>{number(selected.selectedDelivery.heldQuantity)}</dd></div><div><dt>Rejected</dt><dd>{number(selected.selectedDelivery.rejectedQuantity)}</dd></div><div><dt>Short</dt><dd>{number(selected.selectedDelivery.shortQuantity)}</dd></div></dl>{selected.selectedDelivery.lines?.some((line) => line.reason) ? <ul aria-label="Delivery observations">{selected.selectedDelivery.lines.filter((line) => line.reason).map((line) => <li key={line.id}>{inboundActionLabel(line.outcome)} · {line.reason}</li>)}</ul> : null}</SecondaryDetailSection> : null}<SecondaryDetailSection title="References"><dl className="inventory-detail-facts"><div><dt>Purchase order</dt><dd>{inboundReference(selected)}</dd></div><div><dt>Invoice</dt><dd>{selected.invoiceCount > 1 ? selected.invoiceNumbers.join(", ") : selected.invoiceNumber || "No invoice"}</dd></div><div><dt>Owner</dt><dd>{selected.ownerLabel || "Unassigned"}</dd></div></dl></SecondaryDetailSection></>}{action ? <Button variant="primary" onClick={() => runAction(selected)}>{action.label}</Button> : null}</div> : null}
    </SecondaryDetailPanel>
  </section>;
}
