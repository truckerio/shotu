import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button.jsx";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { useCheckpointPages } from "../../components/operations/useCheckpointPages.js";
import { CheckpointCollection } from "../../components/ui/CheckpointCollection.jsx";
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
  const [deferredQuery, setDeferredQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [consumedSourceId, setConsumedSourceId] = useState("");
  const [approvalId, setApprovalId] = useState(() => new URLSearchParams(window.location.search).get("approvalId") || "");

  useEffect(() => {
    const timer = window.setTimeout(() => setDeferredQuery(query), query ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [query]);
  const inboundQueryKey = useMemo(() => JSON.stringify({ view, locationId, query: deferredQuery }), [view, locationId, deferredQuery]);
  const fetchInboundPage = useCallback(async (page, { signal }) => {
    const value = await api(inboundRequestUrl({ view, locationId, query: deferredQuery, page }), { signal });
    return { items: value.items || [], page: value.page, total: value.total, pageCount: value.pageCount, meta: { counts: value.counts || {} } };
  }, [view, locationId, deferredQuery]);
  const inboundQueue = useCheckpointPages({ queryKey: inboundQueryKey, fetchPage: fetchInboundPage, getItemKey: (item) => item.id });
  const items = useMemo(() => inboundQueue.pages.flatMap((batch) => batch.items), [inboundQueue.pages]);
  const counts = inboundQueue.pages[0]?.meta?.counts || {};

  const initialSourceId = initialReceiptId || initialDeliveryId;
  useEffect(() => {
    if (!initialSourceId || approvalId || consumedSourceId === initialSourceId) return undefined;
    let active = true;
    api(`/api/office/inventory/inbound/${encodeURIComponent(initialSourceId)}`)
      .then((result) => { if (active) { if (result.item) { setSelectedDetail(result.item); setSelectedId(result.item.id); } setConsumedSourceId(initialSourceId); } })
      .catch(() => { if (active) setConsumedSourceId(initialSourceId); /* A closed or missing source falls back to the normal inbound list. */ });
    return () => { active = false; };
  }, [approvalId, consumedSourceId, initialSourceId]);

  const selected = useMemo(() => selectedDetail || items.find((item) => item.id === selectedId) || null, [items, selectedDetail, selectedId]);
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
    <OperationalCollectionTabs ariaLabel="Inbound views" activeId={view} onChange={setView} items={INBOUND_VIEWS.map((item) => ({ ...item, count: inboundCount(counts, item.id), countLabel: `${inboundCount(counts, item.id)} inbound items` }))} />
    <OperationalCollectionToolbar className="inventory-inbound-toolbar">
      <label><span>Shop</span><Dropdown aria-label="Inbound shop" value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">All shops</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</Dropdown></label>
      <label><span>Search</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="PO, supplier, invoice" aria-label="Search inbound work" /></label>
    </OperationalCollectionToolbar>
    <CheckpointCollection queue={inboundQueue} label="inbound items" pageSize={100} storageKey={`inventory-inbound:${inboundQueryKey}`} ariaLabel="Inbound work" renderItems={(entries) => entries.length ? <OperationalDataTable ariaLabel="Inbound work" columns={columns} className="inventory-data-table inventory-inbound-table">{entries.map(({ item, key, rowProps }) => <OperationalDataRow {...rowProps} id={item.id} key={key}>
      <OperationalDataCell label="Inbound"><button type="button" className="inventory-inbound-open" onClick={() => { setSelectedDetail(item); setSelectedId(item.id); }}><strong>{item.supplier || "Supplier not set"}</strong><span>{item.locationName || "Shop not set"} · {inboundReference(item)}</span><small>{item.invoiceCount > 1 ? `${item.invoiceCount} invoices` : item.invoiceNumber ? `Invoice ${item.invoiceNumber}` : "No invoice"}</small></button></OperationalDataCell>
      <OperationalDataCell label="Status"><strong>{inboundStatus(item)}</strong><small>{item.invoiceStatus ? inboundProgress(item) : `${number(item.heldQuantity)} held · ${number(item.rejectedQuantity)} rejected · ${number(item.shortQuantity)} short`}</small></OperationalDataCell>
      <OperationalDataCell label="Next"><button type="button" className="inventory-inbound-open" onClick={() => { setSelectedDetail(item); setSelectedId(item.id); }}><strong>{inboundActionLabel(item.nextAction)}</strong><small>{item.ownerLabel || "Unassigned"}</small></button></OperationalDataCell>
    </OperationalDataRow>)}</OperationalDataTable> : null}><p className="inventory-inbound-empty">No inbound work matches this view.</p></CheckpointCollection>
    <SecondaryDetailPanel open={!!selected} onOpenChange={(open) => { if (!open) { const url = new URL(window.location.href); url.searchParams.delete("receiptId"); url.searchParams.delete("deliveryId"); window.history.replaceState({}, "", url); setSelectedId(""); setSelectedDetail(null); } }} eyebrow="Inbound" title={selected?.supplier || "Inbound work"} description={selected ? `${selected.locationName || "Shop not set"} · ${inboundReference(selected)}` : ""}>
      {selected ? <div className="inventory-inbound-detail">{selected.invoiceStatus ? <SecondaryDetailSection title="Invoice status"><dl className="inventory-detail-facts"><div><dt>Status</dt><dd>{inboundStatus(selected)}</dd></div><div><dt>Invoice</dt><dd>{selected.invoiceNumber || "Not identified"}</dd></div><div><dt>Shop</dt><dd>{selected.locationName || "Shop not set"}</dd></div><div><dt>Owner</dt><dd>{selected.ownerLabel || "Invoice intake"}</dd></div></dl></SecondaryDetailSection> : <><SecondaryDetailSection title="Receipt progress">{selected.uomCodes?.length > 1 ? <dl className="inventory-detail-facts"><div><dt>Units</dt><dd>{selected.uomCodes.join(", ")}</dd></div></dl> : <dl className="inventory-detail-facts"><div><dt>Expected</dt><dd>{number(selected.expectedQuantity)}</dd></div><div><dt>Received</dt><dd>{number(selected.receivedQuantity)}</dd></div><div><dt>Remaining</dt><dd>{number(selected.remainingQuantity)}</dd></div><div><dt>Held</dt><dd>{number(selected.heldQuantity)}</dd></div><div><dt>Rejected</dt><dd>{number(selected.rejectedQuantity)}</dd></div><div><dt>Short</dt><dd>{number(selected.shortQuantity)}</dd></div></dl>}</SecondaryDetailSection>{selected.selectedDelivery ? <SecondaryDetailSection title="Selected delivery"><dl className="inventory-detail-facts"><div><dt>Reference</dt><dd>{selected.selectedDelivery.reference || selected.selectedDelivery.id}</dd></div><div><dt>Received by</dt><dd>{selected.selectedDelivery.receivedBy?.displayName || "Team member"}</dd></div><div><dt>Received</dt><dd>{number(selected.selectedDelivery.actualQuantity)}</dd></div><div><dt>Held</dt><dd>{number(selected.selectedDelivery.heldQuantity)}</dd></div><div><dt>Rejected</dt><dd>{number(selected.selectedDelivery.rejectedQuantity)}</dd></div><div><dt>Short</dt><dd>{number(selected.selectedDelivery.shortQuantity)}</dd></div></dl>{selected.selectedDelivery.lines?.some((line) => line.reason) ? <ul aria-label="Delivery observations">{selected.selectedDelivery.lines.filter((line) => line.reason).map((line) => <li key={line.id}>{inboundActionLabel(line.outcome)} · {line.reason}</li>)}</ul> : null}</SecondaryDetailSection> : null}<SecondaryDetailSection title="References"><dl className="inventory-detail-facts"><div><dt>Purchase order</dt><dd>{inboundReference(selected)}</dd></div><div><dt>Invoice</dt><dd>{selected.invoiceCount > 1 ? selected.invoiceNumbers.join(", ") : selected.invoiceNumber || "No invoice"}</dd></div><div><dt>Owner</dt><dd>{selected.ownerLabel || "Unassigned"}</dd></div></dl></SecondaryDetailSection></>}{action ? <Button variant="primary" onClick={() => runAction(selected)}>{action.label}</Button> : null}</div> : null}
    </SecondaryDetailPanel>
  </section>;
}
