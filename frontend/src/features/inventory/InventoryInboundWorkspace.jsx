import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DotsHorizontal, UploadCloud02, XClose } from "@untitledui/icons";
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { Button } from "../../components/ui/Button.jsx";
import { IconButton } from "../../components/ui/IconButton.jsx";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { useCheckpointPages } from "../../components/operations/useCheckpointPages.js";
import { CheckpointCollection } from "../../components/ui/CheckpointCollection.jsx";
import { OperationalDataCell, OperationalDataRow, OperationalDataTable } from "../../components/ui/OperationalDataTable.jsx";
import { SecondaryDetailPanel, SecondaryDetailSection } from "../../components/ui/SecondaryDetailPanel.jsx";
import { OperationalCollectionTabs, OperationalCollectionToolbar } from "../../components/operations/OperationalCollectionPage.jsx";
import { api } from "../../lib/api.js";
import { DirectReceiptApprovalDetail } from "./DirectReceiptApprovalDetail.jsx";
import { InboundInvoiceDocument } from "./InboundInvoiceDocument.jsx";
import { INBOUND_VIEWS, inboundAction, inboundActionLabel, inboundCount, inboundProgress, inboundReference, inboundRequestUrl, inboundStatus } from "./inventory-inbound-model.js";

const columns = [{ id: "inbound", label: "Inbound", isRowHeader: true }, { id: "status", label: "Status" }, { id: "next", label: "Next" }];
const comparisonColumns = columns.slice(0, 2);
const number = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export function InventoryInboundWorkspace({ billUploadControl, locations, onOpenInvoice, onReceivePurchaseOrder, onAddInventory, onUploadInvoice, onResolvedLocation, onComparisonSelect, onComparisonClear, initialReceiptId = "", initialDeliveryId = "", embedded = false, comparison = false, controlledLocationId = "", refreshKey = 0, linkedPurchaseOrderId = "", linkedPurchaseOrderStatus = "", linkedRequestKey = 0, clearSelectionKey = 0 }) {
  const [view, setView] = useState("my_work");
  const [locationId, setLocationId] = useState("");
  const [query, setQuery] = useState("");
  const [deferredQuery, setDeferredQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [exactSourceId, setExactSourceId] = useState("");
  const [consumedSourceId, setConsumedSourceId] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [linkedLoading, setLinkedLoading] = useState(false);
  const [approvalId, setApprovalId] = useState(() => new URLSearchParams(window.location.search).get("approvalId") || "");
  const onResolvedLocationRef = useRef(onResolvedLocation);
  const resolvedLocationRef = useRef("");
  const previousLocationRef = useRef("");
  const linkedRequestRef = useRef(0);
  const linkedContextRef = useRef("");
  const selectedDetailRef = useRef(selectedDetail);
  const sourceErrorRef = useRef(sourceError);
  const exactRefreshKeyRef = useRef(refreshKey);
  const onComparisonSelectRef = useRef(onComparisonSelect);
  onResolvedLocationRef.current = onResolvedLocation;
  onComparisonSelectRef.current = onComparisonSelect;
  selectedDetailRef.current = selectedDetail;
  sourceErrorRef.current = sourceError;

  useEffect(() => {
    const timer = window.setTimeout(() => setDeferredQuery(query), query ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [query]);
  const activeLocationId = embedded ? controlledLocationId : locationId;
  useEffect(() => {
    const previousLocationId = previousLocationRef.current;
    previousLocationRef.current = activeLocationId;
    if (!embedded || !previousLocationId || previousLocationId === activeLocationId) return;
    if (resolvedLocationRef.current === activeLocationId) { resolvedLocationRef.current = ""; return; }
    setExactSourceId("");
    setSelectedId("");
    setSelectedDetail(null);
    setSourceError("");
    linkedRequestRef.current += 1;
    linkedContextRef.current = "";
    setLinkedLoading(false);
    setApprovalId(new URLSearchParams(window.location.search).get("approvalId") || "");
  }, [activeLocationId, embedded]);
  const inboundQueryKey = useMemo(() => JSON.stringify({ view, locationId: activeLocationId, query: deferredQuery }), [view, activeLocationId, deferredQuery]);
  const fetchInboundPage = useCallback(async (page, { signal }) => {
    const value = await api(inboundRequestUrl({ view, locationId: activeLocationId, query: deferredQuery, page }), { signal });
    return { items: value.items || [], page: value.page, total: value.total, pageCount: value.pageCount, meta: { counts: value.counts || {} } };
  }, [view, activeLocationId, deferredQuery]);
  const inboundQueue = useCheckpointPages({ queryKey: inboundQueryKey, fetchPage: fetchInboundPage, getItemKey: (item) => item.id, refreshKey });
  const items = useMemo(() => inboundQueue.pages.flatMap((batch) => batch.items), [inboundQueue.pages]);
  const counts = inboundQueue.pages[0]?.meta?.counts || {};

  const initialSourceId = initialReceiptId || initialDeliveryId;
  useEffect(() => {
    if (!comparison || (!linkedPurchaseOrderId && !clearSelectionKey) || !approvalId) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("approvalId");
    window.history.replaceState({}, "", url);
    if (initialSourceId) setConsumedSourceId(initialSourceId);
    setApprovalId("");
  }, [approvalId, clearSelectionKey, comparison, initialSourceId, linkedPurchaseOrderId]);
  useEffect(() => {
    if (!initialSourceId || approvalId || consumedSourceId === initialSourceId) return undefined;
    const requestId = linkedRequestRef.current + 1;
    linkedRequestRef.current = requestId;
    let active = true;
    setSourceError("");
    setLinkedLoading(true);
    api(`/api/office/inventory/inbound/${encodeURIComponent(initialSourceId)}`)
      .then((result) => { if (active && linkedRequestRef.current===requestId) { setLinkedLoading(false); if (result.item) { const resolvedLocationId=result.item.locationId||"";if(resolvedLocationId){resolvedLocationRef.current=resolvedLocationId;onResolvedLocationRef.current?.(resolvedLocationId);}exactRefreshKeyRef.current=refreshKey;setExactSourceId(initialSourceId);setSelectedDetail(result.item);setSelectedId(result.item.id);onComparisonSelectRef.current?.(result.item); } setConsumedSourceId(initialSourceId); } })
      .catch((error) => { if (active && linkedRequestRef.current===requestId) { setLinkedLoading(false); setSourceError(error.message || "The linked delivery or receipt could not be loaded."); setConsumedSourceId(initialSourceId); } });
    return () => { active = false; };
  }, [approvalId, consumedSourceId, initialSourceId]);

  useEffect(() => {
    if (!comparison || !linkedPurchaseOrderId || !activeLocationId) return undefined;
    setExactSourceId("");
    const requestId = linkedRequestRef.current + 1;
    linkedRequestRef.current = requestId;
    const controller = new AbortController();
    const contextKey = `${activeLocationId}:${linkedPurchaseOrderId}`;
    const sameContext = linkedContextRef.current === contextKey;
    linkedContextRef.current = contextKey;
    const preserveDetail = sameContext && selectedDetailRef.current?.poId === linkedPurchaseOrderId;
    const preserveState = preserveDetail || (sameContext && Boolean(sourceErrorRef.current));
    if (!preserveDetail) { setSelectedId(""); setSelectedDetail(null); }
    if (!sameContext) setSourceError("");
    setLinkedLoading(!preserveState);
    api(`/api/office/inventory/inbound/${encodeURIComponent(linkedPurchaseOrderId)}?${new URLSearchParams({ locationId: activeLocationId })}`, { signal: controller.signal })
      .then((result) => {
        if (linkedRequestRef.current !== requestId) return;
        setLinkedLoading(false);
        if (!result.item) { setSourceError("No deliveries or invoices are linked to this purchase order yet."); return; }
        setSelectedDetail(result.item);
        setSelectedId(result.item.id);
      })
      .catch((error) => { if (linkedRequestRef.current === requestId && error?.name !== "AbortError") { setLinkedLoading(false); setSourceError(["draft", "awaiting_approval"].includes(linkedPurchaseOrderStatus) ? "No deliveries or invoices are linked to this purchase order yet." : error.message || "The linked delivery or invoice could not be loaded."); } });
    return () => controller.abort();
  }, [activeLocationId, comparison, linkedPurchaseOrderId, linkedPurchaseOrderStatus, linkedRequestKey, refreshKey]);

  useEffect(() => {
    if (!comparison || linkedPurchaseOrderId || exactSourceId || !selectedId) return;
    const listed = items.find((item) => item.id === selectedId);
    if (listed) { setSelectedDetail(listed); return; }
    if (!refreshKey) return;
    const requestId = linkedRequestRef.current + 1;
    linkedRequestRef.current = requestId;
    const controller = new AbortController();
    api(`/api/office/inventory/inbound/${encodeURIComponent(selectedId)}`, { signal: controller.signal })
      .then((result) => { if (linkedRequestRef.current === requestId && result.item) setSelectedDetail(result.item); })
      .catch((error) => { if (error?.name !== "AbortError") { /* Keep the visible selection during a transient refresh failure. */ } });
    return () => controller.abort();
  }, [comparison, exactSourceId, items, linkedPurchaseOrderId, refreshKey, selectedId]);

  useEffect(() => {
    if (!comparison || !exactSourceId || exactRefreshKeyRef.current === refreshKey) return undefined;
    exactRefreshKeyRef.current = refreshKey;
    const requestId = linkedRequestRef.current + 1;
    linkedRequestRef.current = requestId;
    const controller = new AbortController();
    api(`/api/office/inventory/inbound/${encodeURIComponent(exactSourceId)}`, { signal: controller.signal })
      .then((result) => { if (linkedRequestRef.current === requestId && result.item) { setSelectedDetail(result.item); setSelectedId(result.item.id); } })
      .catch((error) => { if (error?.name !== "AbortError") { /* Keep the exact selected source visible during a transient refresh failure. */ } });
    return () => controller.abort();
  }, [comparison, exactSourceId, refreshKey]);

  useEffect(() => {
    if (!comparison || !clearSelectionKey) return;
    linkedRequestRef.current += 1;
    linkedContextRef.current = "";
    setExactSourceId("");
    setSelectedId("");
    setSelectedDetail(null);
    setSourceError("");
    setLinkedLoading(false);
  }, [clearSelectionKey, comparison]);

  const selected = useMemo(() => selectedDetail || items.find((item) => item.id === selectedId) || null, [items, selectedDetail, selectedId]);
  function selectInboundItem(item) { linkedRequestRef.current += 1; linkedContextRef.current = ""; setExactSourceId(""); setLinkedLoading(false); setSelectedDetail(item); setSelectedId(item.id); setSourceError(""); onComparisonSelect?.(item); }
  function clearInboundSelection() { linkedRequestRef.current += 1; linkedContextRef.current = ""; setExactSourceId(""); setLinkedLoading(false); setSelectedId(""); setSelectedDetail(null); setSourceError(""); onComparisonClear?.(); }
  function runAction(item) {
    const action = inboundAction(item);
    if (action?.id === "invoice") onOpenInvoice?.(item.invoiceRunId, item.locationId);
    if (action?.id === "purchase_order") onReceivePurchaseOrder?.(item.poId, item.locationId, item.poNumber);
    if (action?.id === "inventory") onAddInventory?.(item.locationId);
    if (action?.id === "invoice_upload") onUploadInvoice?.(item.locationId);
  }
  const action = selected ? inboundAction(selected) : null;
  if (approvalId) return <DirectReceiptApprovalDetail approvalId={approvalId} onResolvedLocation={(resolvedLocationId) => { resolvedLocationRef.current=resolvedLocationId;onResolvedLocationRef.current?.(resolvedLocationId); }} onClose={() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("approvalId");
    window.history.replaceState({}, "", url);
    setApprovalId("");
  }} />;
  const detailContent = selected ? <div className="inventory-inbound-detail">
    <InboundInvoiceDocument key={`${selected.locationId}:${selected.id}:${selected.selectedDelivery?.id || ""}`} item={selected} refreshKey={refreshKey} onOpenInvoice={onOpenInvoice} onUploadInvoice={onUploadInvoice} uploadControl={billUploadControl}/>
    {!selected.invoiceStatus ? <details className="inbound-delivery-evidence" open={Boolean(selected.selectedDelivery || selected.heldQuantity || selected.rejectedQuantity || selected.shortQuantity)}>
      <summary>Recorded delivery · {inboundProgress(selected)}</summary>
      <SecondaryDetailSection title="Receipt progress">{selected.uomCodes?.length > 1 ? <p>Units: {selected.uomCodes.join(", ")}</p> : <dl className="inventory-detail-facts"><div><dt>Expected</dt><dd>{number(selected.expectedQuantity)}</dd></div><div><dt>Received</dt><dd>{number(selected.receivedQuantity)}</dd></div><div><dt>Remaining</dt><dd>{number(selected.remainingQuantity)}</dd></div><div><dt>Held</dt><dd>{number(selected.heldQuantity)}</dd></div><div><dt>Rejected</dt><dd>{number(selected.rejectedQuantity)}</dd></div><div><dt>Short</dt><dd>{number(selected.shortQuantity)}</dd></div></dl>}</SecondaryDetailSection>
      {selected.selectedDelivery ? <SecondaryDetailSection title="Selected delivery"><dl className="inventory-detail-facts"><div><dt>Reference</dt><dd>{selected.selectedDelivery.reference || selected.selectedDelivery.id}</dd></div><div><dt>Received by</dt><dd>{selected.selectedDelivery.receivedBy?.displayName || "Team member"}</dd></div><div><dt>Received</dt><dd>{number(selected.selectedDelivery.actualQuantity)}</dd></div><div><dt>Held</dt><dd>{number(selected.selectedDelivery.heldQuantity)}</dd></div><div><dt>Rejected</dt><dd>{number(selected.selectedDelivery.rejectedQuantity)}</dd></div><div><dt>Short</dt><dd>{number(selected.selectedDelivery.shortQuantity)}</dd></div></dl>{selected.selectedDelivery.lines?.some((line) => line.reason) ? <ul aria-label="Delivery observations">{selected.selectedDelivery.lines.filter((line) => line.reason).map((line) => <li key={line.id}>{inboundActionLabel(line.outcome)} · {line.reason}</li>)}</ul> : null}</SecondaryDetailSection> : null}
      <dl className="inventory-detail-facts"><div><dt>Linked purchase order</dt><dd>{inboundReference(selected)}</dd></div><div><dt>Shop</dt><dd>{selected.locationName || "Shop not set"}</dd></div><div><dt>Owner</dt><dd>{selected.ownerLabel || "Unassigned"}</dd></div></dl>
    </details> : null}
    {action && action.id !== "invoice" ? <Button variant="primary" onClick={() => runAction(selected)}>{action.label}</Button> : null}
  </div> : null;
  return <section className="inventory-inbound-workspace">
    {comparison ? <header className="purchasing-pane-header">
      {selected || sourceError || linkedLoading ? <nav className="purchase-order-document-navigation" aria-label="Delivery navigation"><Button onClick={clearInboundSelection}>All deliveries</Button></nav> : <h3>Deliveries &amp; invoices</h3>}
      <div className="purchasing-section-actions">
        {query || view !== "my_work" ? <IconButton icon={XClose} label="Clear delivery and invoice filters" onClick={() => { setQuery(""); setView("my_work"); }} /> : null}
        <IconButton icon={UploadCloud02} label="Upload invoice" disabled={!activeLocationId} onClick={() => onUploadInvoice?.(activeLocationId)} />
        <MenuTrigger>
          <AriaButton className="shared-icon-button is-neutral" aria-label="More delivery and invoice actions" title="More delivery and invoice actions" isDisabled={!activeLocationId}><DotsHorizontal aria-hidden="true" /></AriaButton>
          <Popover className="purchasing-actions-popover" placement="bottom end">
            <Menu className="purchasing-actions-menu" aria-label="Delivery and invoice actions">
              <MenuItem className="purchasing-actions-item" onAction={() => onAddInventory?.(activeLocationId)}>Record delivery without PO</MenuItem>
            </Menu>
          </Popover>
        </MenuTrigger>
      </div>
    </header> : null}
    {!embedded?<OperationalCollectionTabs ariaLabel="Inbound views" activeId={view} onChange={setView} items={INBOUND_VIEWS.map((item) => ({ ...item, count: inboundCount(counts, item.id), countLabel: `${inboundCount(counts, item.id)} inbound items` }))} />:null}
    {!comparison || !selected ? <OperationalCollectionToolbar className="inventory-inbound-toolbar">
      <label><span>Search</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="PO, supplier, invoice" aria-label="Search inbound work" /></label>
      {!embedded?<label><span>Shop</span><Dropdown aria-label="Inbound shop" value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">All shops</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</Dropdown></label>:<label><span>View</span><Dropdown aria-label="Delivery and invoice view" value={view} onChange={(event) => setView(event.target.value)}>{INBOUND_VIEWS.map((item) => <option key={item.id} value={item.id}>{item.label} ({inboundCount(counts, item.id)})</option>)}</Dropdown></label>}
    </OperationalCollectionToolbar> : null}
    {linkedLoading ? <p role="status" className="purchasing-pair-message">Loading linked deliveries and invoices…</p> : sourceError ? <p role={comparison?"status":"alert"} className={comparison?"purchasing-pair-message":"ops-error"}>{sourceError}</p> : null}
    {!linkedLoading&&(!comparison||(!selected&&!sourceError))?<CheckpointCollection queue={inboundQueue} label="inbound items" pageSize={100} storageKey={`inventory-inbound:${inboundQueryKey}`} ariaLabel="Inbound work" statusPlacement={comparison?"footer":"overlay"} renderItems={(entries) => entries.length ? <OperationalDataTable ariaLabel="Inbound work" columns={comparison?comparisonColumns:columns} className="inventory-data-table inventory-inbound-table">{entries.map(({ item, key, rowProps }) => <OperationalDataRow {...rowProps} id={item.id} key={key}>
      <OperationalDataCell label="Inbound"><button type="button" className="inventory-inbound-open" onClick={() => selectInboundItem(item)}><strong>{item.supplier || "Supplier not set"}</strong><span>{item.locationName || "Shop not set"} · {inboundReference(item)}</span><small>{item.invoiceCount > 1 ? `${item.invoiceCount} invoices` : item.invoiceNumber ? `Invoice ${item.invoiceNumber}` : "No invoice"}</small></button></OperationalDataCell>
      <OperationalDataCell label="Status"><strong>{inboundStatus(item)}</strong><small>{item.invoiceStatus ? inboundProgress(item) : `${number(item.heldQuantity)} held · ${number(item.rejectedQuantity)} rejected · ${number(item.shortQuantity)} short`}</small></OperationalDataCell>
      {!comparison?<OperationalDataCell label="Next"><button type="button" className="inventory-inbound-open" onClick={() => selectInboundItem(item)}><strong>{inboundActionLabel(item.nextAction)}</strong><small>{item.ownerLabel || "Unassigned"}</small></button></OperationalDataCell>:null}
    </OperationalDataRow>)}</OperationalDataTable> : null}><p className="inventory-inbound-empty">No inbound work matches this view.</p></CheckpointCollection>
    :selected?<section className="purchasing-inline-detail">{detailContent}</section>:null}
    {!comparison?<>
    <SecondaryDetailPanel open={!!selected} onOpenChange={(open) => { if (!open) { const url = new URL(window.location.href); url.searchParams.delete("receiptId"); url.searchParams.delete("deliveryId"); window.history.replaceState({}, "", url); setSelectedId(""); setSelectedDetail(null); } }} eyebrow="Inbound" title={selected?.supplier || "Inbound work"} description={selected ? `${selected.locationName || "Shop not set"} · ${inboundReference(selected)}` : ""}>
      {detailContent}
    </SecondaryDetailPanel>
    </>:null}
  </section>;
}
