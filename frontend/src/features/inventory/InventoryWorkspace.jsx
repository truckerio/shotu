import { InventoryLocationStockWorkspace } from "./InventoryLocationStockWorkspace.jsx";
import { PartPositionsPanel } from "./PartPositionsPanel.jsx";
import { PartCommercialDetails } from "./PartCommercialDetails.jsx";
import './inventory-tables.css';
import { InventoryPurchases } from './InventoryPurchases.jsx';
import { InventoryInboundWorkspace } from './InventoryInboundWorkspace.jsx';
import { InventoryStockTasks } from './InventoryStockTasks.jsx';
import { InventoryReports } from './InventoryReports.jsx';
import { InventoryTaskQueue } from './InventoryTaskQueue.jsx';
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Package, Plus, RefreshCw01, SearchMd, UploadCloud02 } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { IconButton } from "../../components/ui/IconButton.jsx";
import { ContextBreadcrumbs } from "../../components/ui/ContextBreadcrumbs.jsx";
import { isPlainPrimaryActivation } from "../../components/ui/context-navigation.js";
import { Pagination } from "../../components/ui/Pagination.jsx";
import { SecondaryDetailPanel, SecondaryDetailSection } from "../../components/ui/SecondaryDetailPanel.jsx";
import {
  OperationalCollectionCell,
  OperationalCollectionPage,
  OperationalCollectionResultHeader,
  OperationalCollectionRow,
  OperationalCollectionSectionHeader,
  OperationalCollectionTable,
  OperationalCollectionTabs,
  OperationalCollectionToolbar,
} from "../../components/operations/OperationalCollectionPage.jsx";
import { api } from "../../lib/api.js";
import { InvoiceExtractionWorkspace } from "../office/InvoiceExtractionWorkspace.jsx";
import { PartIdentityEditor } from "./PartIdentityEditor.jsx";
import { PartLocationSettings } from "./PartLocationSettings.jsx";
import { CreateInventoryPartDialog } from "./CreateInventoryPartDialog.jsx";
import { AddInventoryStockDialog } from "./AddInventoryStockDialog.jsx";
import { StockMovementHistory } from "./StockMovementHistory.jsx";
import { PartSerializationPanel } from "./PartSerializationPanel.jsx";
import { InventoryAuthorityExceptionsPanel } from "./InventoryAuthorityExceptionsPanel.jsx";
import { InventoryCustodyWorkspace } from "./InventoryCustodyWorkspace.jsx";
import {
  DEFAULT_STOCK_SORT,
  STOCK_FILTER_OPTIONS,
  stockState,
  stockStateLabel,
} from "./inventory-workspace-model.js";
import { hasRefreshedPartIdentityVersion } from "./part-identity-editor-model.js";
import { configuredPriceView, effectiveSellingPrice } from "./part-commercial-model.js";
import "./inventory-workspace.css";

let inventoryCountPanelPromise;
function loadInventoryCountPanel() {
  inventoryCountPanelPromise ||= import("./InventoryCountImportPanel.jsx")
    .then((module) => ({ default: module.InventoryCountImportPanel }));
  return inventoryCountPanelPromise;
}
const InventoryCountImportPanel = lazy(loadInventoryCountPanel);

function quantity(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(Number(value || 0));
}

function locationHasStock(location) {
  return [location.quantityOnHand, location.quantityReserved, location.quantityAvailable, location.odooQuantityOnHand]
    .some((value) => Number(value || 0) !== 0);
}

function inventoryUrl({ invoiceRun = "", upload = false, countImport = "", count = false } = {}) {
  const url = new URL(window.location.href);
  url.searchParams.set("view", "inventory");
  if (url.searchParams.has("adminView")) url.searchParams.set("adminView", "inventory");
  if (invoiceRun) url.searchParams.set("invoiceRun", invoiceRun);
  else url.searchParams.delete("invoiceRun");
  if (upload) url.searchParams.set("inventoryAction", "upload-invoice");
  else if (count) url.searchParams.set("inventoryAction", "count");
  else url.searchParams.delete("inventoryAction");
  if (countImport) url.searchParams.set("countImport", countImport);
  else url.searchParams.delete("countImport");
  return url;
}

function stockItemKey(item) {
  return `${item.companyId}:${item.catalogPartId}`;
}

export function InventoryWorkspace({ actorId = "", canApplyInventoryCount = false, canReconcileAuthority = false, presentation = "page" }) {
  const initialParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const [invoiceWorkflowOpen, setInvoiceWorkflowOpen] = useState(() => (
    initialParams.get("view") === "invoices"
      || initialParams.has("invoiceRun")
      || initialParams.get("inventoryAction") === "upload-invoice"
  ));
  const [countWorkflowOpen, setCountWorkflowOpen] = useState(() => (
    initialParams.has("countImport") || initialParams.get("inventoryAction") === "count"
  ));
  const [invoiceUploadOpen, setInvoiceUploadOpen] = useState(() => (
    initialParams.get("inventoryAction") === "upload-invoice"
  ));
  const [countUploadOpen, setCountUploadOpen] = useState(false);
  const [workflowDetail, setWorkflowDetail] = useState(null);
  const [query, setQuery] = useState("");
  const [locationId, setLocationId] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [stockSort, setStockSort] = useState(DEFAULT_STOCK_SORT);
  const [stockMode, setStockMode] = useState(() => initialParams.get("stockMode") === "location" ? "location" : "part");
  const [locations, setLocations] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stockLoaded, setStockLoaded] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedStockKey, setSelectedStockKey] = useState("");
  const [selectedLocationPart, setSelectedLocationPart] = useState(null);
  const [selectedPositionContext, setSelectedPositionContext] = useState(null);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [partDetailPage, setPartDetailPage] = useState("stock");
  const [shelvingOpen, setShelvingOpen] = useState(false);
  const [partIdentityBusy, setPartIdentityBusy] = useState(false);
  const [partIdentityDirty, setPartIdentityDirty] = useState(false);
  const [partIdentityOverride, setPartIdentityOverride] = useState(null);
  const [partIdentityRefreshPending, setPartIdentityRefreshPending] = useState(null);
  const [partHeaderPrice, setPartHeaderPrice] = useState({ scopeKey: "", label: "" });
  const [createPartOpen, setCreatePartOpen] = useState(false);
  const [receivingPart, setReceivingPart] = useState(null);
  const [stockPage, setStockPage] = useState(1);
  const [inventorySection, setInventorySection] = useState(() => ["inbound", "purchases", "tasks", "reports"].includes(initialParams.get("inventorySection")) ? initialParams.get("inventorySection") : "stock");
  const [inboundReceiptOrderId, setInboundReceiptOrderId] = useState("");
  const [reportPurchaseOrderId] = useState(() => initialParams.get("purchaseOrderId") || "");
  const [reportPurchaseOrderNumber] = useState(() => initialParams.get("purchaseOrderNumber") || "");
  const [inboundSource, setInboundSource] = useState(() => ({ receiptId: initialParams.get("receiptId") || "", deliveryId: initialParams.get("deliveryId") || "" }));
  const [stockLocationInitialShop, setStockLocationInitialShop] = useState(() => initialParams.get("taskLocation") || "");
  const [stockLocationInitialPosition, setStockLocationInitialPosition] = useState(() => initialParams.get("positionId") || "");
  const [taskSection,setTaskSection]=useState(() => ["transfer", "count"].includes(initialParams.get("taskOwner")) ? initialParams.get("taskOwner") : "damage");
  const [taskPart,setTaskPart]=useState(null);
  const [taskLocationId,setTaskLocationId]=useState(() => initialParams.get("taskLocation") || "");
  const [taskWorkflow,setTaskWorkflow]=useState(() => {
    const owner = initialParams.get("taskOwner");
    if (owner === "count" && !initialParams.get("taskId")) return { kind: "stock", task: null };
    if (["damage", "transfer", "count"].includes(owner) && initialParams.get("taskId")) return { kind: "stock", task: { sourceId: initialParams.get("taskId") } };
    if (owner === "custody" && initialParams.get("reuseCaseId")) return { kind: "custody", task: { sourceId: initialParams.get("reuseCaseId") } };
    return null;
  });
  const [stockMeta, setStockMeta] = useState({ pageCount: 1, total: 0, counts: { all: 0, available: 0, reserved: 0, out: 0 } });

  useEffect(() => {
    api("/api/office/template")
      .then((result) => setLocations((result.locations || []).map((entry) => entry.location).filter(Boolean)))
      .catch(() => setLocations([]));
  }, []);

  useEffect(() => {
    if (invoiceWorkflowOpen || countWorkflowOpen) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: "20", page: String(stockPage) });
        params.set("sort", stockSort);
        if (query.trim()) params.set("q", query.trim());
        if (stockFilter !== "all") params.set("availability", stockFilter);
        if (locationId === "master") params.set("scope", "master");
        else if (locationId !== "all") params.set("locationId", locationId);
        const result = await api(`/api/office/inventory/stock?${params}`);
        if (active) {
          setItems(result.items || []);
          setStockMeta({ pageCount: Number(result.pageCount) || 1, total: Number(result.total) || 0, counts: result.counts || { all: 0, available: 0, reserved: 0, out: 0 } });
          setStockLoaded(true);
        }
      } catch (nextError) {
        if (active) setError(nextError.message);
      } finally {
        if (active) setLoading(false);
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      active = false;
    };
  }, [countWorkflowOpen, invoiceWorkflowOpen, locationId, query, refreshKey, stockFilter, stockPage, stockSort]);

  useEffect(() => setStockPage(1), [locationId, query, stockFilter, stockSort]);

  const stockCounts = stockMeta.counts;
  const initialLoading = loading && !stockLoaded;
  const refreshing = loading && stockLoaded;
  const selectedItem = useMemo(() => {
    const item = selectedLocationPart && stockItemKey(selectedLocationPart) === selectedStockKey
      ? selectedLocationPart
      : items.find((entry) => stockItemKey(entry) === selectedStockKey) || null;
    return item && partIdentityOverride?.catalogPartId === item.catalogPartId ? { ...item, ...partIdentityOverride } : item;
  }, [items, partIdentityOverride, selectedLocationPart, selectedStockKey]);
  const selectedLocation = selectedItem?.locations.find((location) => location.locationId === selectedLocationId) || null;
  const stockedLocations = selectedItem?.locations.filter(locationHasStock) || [];
  const otherLocations = selectedItem?.locations.filter((location) => !locationHasStock(location)) || [];
  const partHeaderPriceScopeKey = selectedItem?.catalogPartId ? `${selectedItem.catalogPartId}:${selectedLocation?.locationId || "company"}` : "";

  useEffect(() => {
    if (!selectedItem?.catalogPartId) {
      setPartHeaderPrice({ scopeKey: "", label: "" });
      return undefined;
    }
    let active = true;
    const scopeKey = partHeaderPriceScopeKey;
    setPartHeaderPrice({ scopeKey, label: "…" });
    const params = new URLSearchParams({ limit: "1" });
    if (selectedLocation?.locationId) params.set("locationId", selectedLocation.locationId);
    api(`/api/office/inventory/parts/${encodeURIComponent(selectedItem.catalogPartId)}/commercial?${params}`)
      .then((commercial) => {
        if (!active) return;
        const price = effectiveSellingPrice(commercial, Boolean(selectedLocation?.locationId));
        const view = configuredPriceView(price);
        setPartHeaderPrice({ scopeKey, label: view.label === "Unknown" ? "—" : view.label });
      })
      .catch(() => {
        if (active) setPartHeaderPrice({ scopeKey, label: "—" });
      });
    return () => { active = false; };
  }, [partHeaderPriceScopeKey, refreshKey, selectedItem?.catalogPartId, selectedLocation?.locationId]);

  function closeSelectedPart() {
    setSelectedStockKey("");
    setSelectedLocationPart(null);
    setSelectedPositionContext(null);
  }

  function openListedPart(item) {
    setSelectedLocationPart(null);
    setSelectedPositionContext(null);
    setSelectedStockKey(stockItemKey(item));
  }

  async function openLocationPart({ item, shopId, positionId, positionPath, canStore }) {
    const params = new URLSearchParams({ q: item.partNumber || "", locationId: shopId, limit: "100", page: "1" });
    const result = await api(`/api/office/inventory/stock?${params}`);
    const fullItem = (result.items || []).find((entry) => entry.catalogPartId === (item.catalogPartId || item.partId || item.id));
    if (!fullItem) throw new Error("This part is no longer available at the selected location. Refresh and try again.");
    setSelectedLocationPart(fullItem);
    setSelectedPositionContext({ shopId, positionId: canStore ? positionId : "", positionPath });
    setSelectedStockKey(stockItemKey(fullItem));
  }

  function openStockTransfer(part, sourceLocationId) {
    setTaskPart(part);
    setTaskLocationId(sourceLocationId);
    setTaskSection('transfer');
    setTaskWorkflow({ kind: 'stock' });
    setInventorySection('tasks');
    closeSelectedPart();
  }

  function openStockDamage(part, sourceLocationId, serialNumber = "") {
    setTaskPart(serialNumber ? { ...part, damageSerialNumber: serialNumber } : part);
    setTaskLocationId(sourceLocationId);
    setTaskSection("damage");
    setTaskWorkflow({ kind: "stock" });
    setInventorySection("tasks");
    closeSelectedPart();
  }

  function partLocationRow(location) {
    return <div className="inventory-detail-location-row" key={location.locationId}>
      <button type="button" onClick={() => setSelectedLocationId(location.locationId)}>
        <div><strong>{location.locationName}</strong><small><b>{quantity(location.quantityAvailable)} {selectedItem.uomCode}</b> available{Number(location.odooQuantityOnHand || 0) > 0 ? <> · {quantity(location.odooQuantityOnHand)} {selectedItem.uomCode} in Odoo</> : null}</small></div>
        <ChevronRight aria-hidden="true" />
      </button>
      <PartLocationSettings part={selectedItem} location={location} onOpenShelves={() => { setSelectedLocationId(location.locationId); setShelvingOpen(true); }} onDamage={(sourceLocationId) => openStockDamage(selectedItem, sourceLocationId)} onTransfer={(sourceLocationId) => openStockTransfer(selectedItem, sourceLocationId)} onSaved={() => setRefreshKey((value) => value + 1)} />
    </div>;
  }

  useEffect(() => {
    setSelectedLocationId(selectedPositionContext?.shopId || "");
    setPartDetailPage("stock");
    setShelvingOpen(false);
    setPartIdentityBusy(false);
    setPartIdentityDirty(false);
    setPartIdentityOverride(null);
    setPartIdentityRefreshPending(null);
  }, [selectedPositionContext, selectedStockKey]);

  useEffect(() => {
    if (!partIdentityRefreshPending) return;
    const refreshedItem = items.find((item) => item.catalogPartId === partIdentityRefreshPending.catalogPartId);
    if (!hasRefreshedPartIdentityVersion(refreshedItem, partIdentityRefreshPending)) return;
    setPartIdentityRefreshPending(null);
    window.requestAnimationFrame(() => document.getElementById("inventory-part-name")?.focus({ preventScroll: true }));
  }, [items, partIdentityRefreshPending]);

  const onPartIdentityEditStateChange = useCallback((state) => {
    setPartIdentityBusy(Boolean(state?.busy));
    setPartIdentityDirty(Boolean(state?.dirty));
  }, []);

  function handlePartIdentitySaved(part) {
    setPartIdentityOverride((current) => ({ ...(selectedItem || current || {}), ...(part || {}) }));
    setRefreshKey((value) => value + 1);
    window.requestAnimationFrame(() => document.getElementById("inventory-part-name")?.focus({ preventScroll: true }));
  }

  function reloadPartIdentity() {
    if (!selectedItem) return;
    setPartIdentityOverride(null);
    setPartIdentityRefreshPending({ catalogPartId: selectedItem.catalogPartId, version: selectedItem.version });
    setRefreshKey((value) => value + 1);
  }

  function openInvoiceWorkflow(invoiceRun = "", requestedLocationId = "") {
    if (requestedLocationId && locations.some((location) => location.id === requestedLocationId)) {
      setLocationId(requestedLocationId);
    }
    window.history.replaceState({}, "", inventoryUrl({ invoiceRun, upload: !invoiceRun }));
    setInvoiceWorkflowOpen(true);
    setInvoiceUploadOpen(!invoiceRun);
    setWorkflowDetail(null);
  }

  function openCountWorkflow() {
    window.history.replaceState({}, "", inventoryUrl({ count: true }));
    setCountWorkflowOpen(true);
    setCountUploadOpen(false);
    setWorkflowDetail(null);
  }

  function closeInvoiceWorkflow() {
    const returnFocusId = invoiceWorkflowOpen ? "inventory-invoice-action" : countWorkflowOpen ? "inventory-import-count-action" : "";
    window.history.replaceState({}, "", inventoryUrl());
    setInvoiceWorkflowOpen(false);
    setCountWorkflowOpen(false);
    setInvoiceUploadOpen(false);
    setCountUploadOpen(false);
    setWorkflowDetail(null);
    setRefreshKey((value) => value + 1);
    if (returnFocusId) {
      window.requestAnimationFrame(() => document.getElementById(returnFocusId)?.focus({ preventScroll: true }));
    }
  }

  function followInventoryBreadcrumb(event) {
    if (!isPlainPrimaryActivation(event)) return;
    event.preventDefault();
    closeInvoiceWorkflow();
  }

  const updateWorkflowDetail = useCallback((detailState) => {
    setWorkflowDetail(detailState || null);
  }, []);

  function followWorkflowBreadcrumb(event) {
    if (!isPlainPrimaryActivation(event)) return;
    event.preventDefault();
    workflowDetail?.onBack?.();
  }

  function clearStockView() {
    setQuery("");
    setLocationId("all");
    setStockFilter("all");
    setStockSort(DEFAULT_STOCK_SORT);
  }

  const inventoryTitle = invoiceWorkflowOpen ? "Invoice intake" : countWorkflowOpen ? "Starting inventory" : "";
  const inventorySubtitle = invoiceWorkflowOpen
    ? "Upload, review, and add parts without leaving inventory."
    : countWorkflowOpen
      ? "Import and review starting-inventory count sheets."
      : "";
  const inventoryLeading = invoiceWorkflowOpen || countWorkflowOpen ? <ContextBreadcrumbs
    items={[
      {
        label: "Inventory",
        href: inventoryUrl().toString(),
        onClick: followInventoryBreadcrumb,
      },
      ...(workflowDetail ? [{
        label: invoiceWorkflowOpen ? "Invoice intake" : "Starting inventory",
        href: inventoryUrl(invoiceWorkflowOpen ? { upload: true } : { count: true }).toString(),
        onClick: followWorkflowBreadcrumb,
      }] : []),
    ]}
    current={workflowDetail?.label || inventoryTitle}
  /> : null;
  const inventoryActions = countWorkflowOpen ? (
    <Button type="button" variant="primary" icon={UploadCloud02} onClick={() => setCountUploadOpen(true)}>Import count sheet</Button>
  ) : invoiceWorkflowOpen ? (
    !workflowDetail ? <IconButton className="inventory-invoice-upload-button" icon={UploadCloud02} label="Upload invoices" aria-haspopup="dialog" onClick={() => setInvoiceUploadOpen(true)} /> : null
  ) : null;

  const stockActions = <>
    <Button type="button" variant="primary" onClick={() => setReceivingPart({})} disabled={!locations.length}>Add stock</Button>
    <IconButton className="inventory-refresh-button" icon={RefreshCw01} label="Refresh inventory" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading} />
    <Button type="button" icon={Plus} onClick={() => setCreatePartOpen(true)} disabled={!locations.length}>New part</Button>
  </>;
  const inboundActions = <>
    <Button type="button" variant="primary" onClick={() => setReceivingPart({})} disabled={!locations.length}>Record arrival</Button>
    <Button type="button" icon={UploadCloud02} onClick={() => openInvoiceWorkflow()}>Upload invoice</Button>
  </>;
  const taskActions = !taskWorkflow ? <Button type="button" onClick={openPhysicalCountTasks}>Physical counts</Button> : null;
  const inventorySections = [{ id: "stock", label: "Stock" }, { id: "inbound", label: "Inbound" }, { id: "purchases", label: "Purchasing" }, { id: "tasks", label: "Tasks" }, { id: "reports", label: "Reports" }];
  const sectionActions = inventorySection === "stock" ? stockActions : inventorySection === "inbound" ? inboundActions : inventorySection === "tasks" ? taskActions : null;

  function changeInventorySection(nextSection) {
    setInventorySection(nextSection);
    setTaskWorkflow(null);
    setInboundSource({ receiptId: "", deliveryId: "" });
    const url = new URL(window.location.href);
    url.searchParams.set("inventorySection", nextSection);
    for (const key of ["taskOwner", "taskId", "taskLocation", "reuseCaseId", "positionId", "receiptId", "deliveryId", "stockMode", "stockAction", "queueTaskType", "queueTaskId", "queueTaskLocation"]) url.searchParams.delete(key);
    window.history.replaceState({}, "", url);
  }

  function openExactTaskUrl(values) {
    const url = new URL(window.location.href);
    for (const key of ["taskOwner", "taskId", "taskLocation", "reuseCaseId", "positionId", "receiptId", "deliveryId", "stockMode", "stockAction", "queueTaskType", "queueTaskId", "queueTaskLocation"]) url.searchParams.delete(key);
    for (const [key, value] of Object.entries(values)) if (value) url.searchParams.set(key, value);
    window.history.replaceState({}, "", url);
  }

  function closeTaskOwner() {
    setTaskWorkflow(null);
    openExactTaskUrl({ inventorySection: "tasks" });
  }

  function openTaskOwner(task) {
    const location = task.location?.id || task.actionTarget?.locationId || "";
    if (task.sourceType === "damage_inspection") { setTaskSection("damage"); setTaskLocationId(location); setTaskWorkflow({ kind: "stock", task }); openExactTaskUrl({ inventorySection: "tasks", taskOwner: "damage", taskId: task.sourceId, taskLocation: location }); return; }
    if (task.sourceType === "transfer_receipt") { setTaskSection("transfer"); setTaskLocationId(location); setTaskWorkflow({ kind: "stock", task }); openExactTaskUrl({ inventorySection: "tasks", taskOwner: "transfer", taskId: task.sourceId, taskLocation: location }); return; }
    if (task.sourceType === "removed_part_custody") { setTaskLocationId(location); setTaskWorkflow({ kind: "custody", task }); openExactTaskUrl({ inventorySection: "tasks", taskOwner: "custody", reuseCaseId: task.sourceId, taskLocation: location }); return; }
    if (["position_recount", "position_count_review"].includes(task.sourceType)) { const positionId = task.actionTarget?.positionId || new URL(task.deepLink, window.location.href).searchParams.get("positionId") || ""; setStockLocationInitialShop(location); setStockLocationInitialPosition(positionId); setStockMode("location"); setInventorySection("stock"); openExactTaskUrl({ inventorySection: "stock", stockMode: "location", positionId, taskLocation: location }); return; }
    if (task.sourceType === "invoice_po_decision") { openInvoiceWorkflow(task.sourceId, location); return; }
    if (task.sourceType === "missing_invoice") { setInboundSource({ receiptId: task.sourceId, deliveryId: "" }); setInventorySection("inbound"); openExactTaskUrl({ inventorySection: "inbound", receiptId: task.sourceId, taskLocation: location }); return; }
    if (task.sourceType === "receipt_exception") { setInboundSource({ receiptId: "", deliveryId: task.sourceId }); setInventorySection("inbound"); openExactTaskUrl({ inventorySection: "inbound", deliveryId: task.sourceId, taskLocation: location }); return; }
    window.location.assign(task.deepLink);
  }

  function openStockByLocation(shopId = "") {
    setStockLocationInitialShop(shopId);
    setStockMode("location");
    setInventorySection("stock");
    openExactTaskUrl({ inventorySection: "stock", stockMode: "location", taskLocation: shopId });
  }

  function changeStockMode(nextMode) {
    setStockMode(nextMode);
    openExactTaskUrl({ inventorySection: "stock", stockMode: nextMode === "location" ? "location" : "" });
  }

  function openPhysicalCountTasks() {
    setTaskSection("count");
    setTaskLocationId("");
    setTaskWorkflow({ kind: "stock", task: null });
    setInventorySection("tasks");
    openExactTaskUrl({ inventorySection: "tasks", taskOwner: "count" });
  }

  return (
    <OperationalCollectionPage
      className={`${presentation === "page" ? "admin-content " : ""}inventory-workspace${invoiceWorkflowOpen || countWorkflowOpen ? " is-invoice-workflow" : " is-section-root"}`}
      presentation={presentation}
      title={inventoryTitle}
      subtitle={inventorySubtitle}
      leading={inventoryLeading}
      actions={inventoryActions}
    >
      {createPartOpen ? <CreateInventoryPartDialog
        locationId={locations.some((location) => location.id === locationId) ? locationId : ""}
        locations={locations}
        onClose={() => setCreatePartOpen(false)}
        onCreated={(part) => { setQuery(part.partNumber); setRefreshKey((value) => value + 1); }}
      /> : null}

      {invoiceWorkflowOpen ? <InvoiceExtractionWorkspace embedded availableLocations={locations} initialLocationId={locations.some((location) => location.id === locationId) ? locationId : ""} uploadOpen={invoiceUploadOpen} onUploadOpenChange={setInvoiceUploadOpen} onContextChange={updateWorkflowDetail} /> : countWorkflowOpen ? <Suspense fallback={<div className="inventory-empty"><Package /><strong>Loading count sheets</strong></div>}><InventoryCountImportPanel locations={locations} initialImportId={initialParams.get("countImport") || ""} uploadOpen={countUploadOpen} onUploadOpenChange={setCountUploadOpen} canApplyInventoryCount={canApplyInventoryCount} onApplied={() => setRefreshKey((value) => value + 1)} onContextChange={updateWorkflowDetail} /></Suspense> : <>

      <OperationalCollectionSectionHeader ariaLabel="Other inventory sections" activeId={inventorySection} onChange={changeInventorySection} items={inventorySections} actions={sectionActions} headingLevel={presentation === "embedded" ? 2 : 1} />
      {inventorySection==='inbound'?<InventoryInboundWorkspace locations={locations} initialReceiptId={inboundSource.receiptId} initialDeliveryId={inboundSource.deliveryId} onOpenInvoice={(invoiceRunId, requestedLocationId) => openInvoiceWorkflow(invoiceRunId, requestedLocationId)} onReceivePurchaseOrder={(poId) => { setInboundReceiptOrderId(poId); setInventorySection('purchases'); }} onAddInventory={(requestedLocationId) => setReceivingPart({ receiptLocationId: requestedLocationId })} onUploadInvoice={(requestedLocationId) => openInvoiceWorkflow("", requestedLocationId)}/>:null}
      {inventorySection==='purchases'?<InventoryPurchases key={inventorySection} locations={locations} actorId={actorId} view={inventorySection} initialReceiptOrderId={inboundReceiptOrderId} initialPurchaseOrderId={reportPurchaseOrderId} initialPurchaseOrderNumber={reportPurchaseOrderNumber} onInvoice={(requestedLocationId)=>openInvoiceWorkflow("", requestedLocationId)} onStock={()=>setInventorySection('stock')}/>:null}
      {inventorySection==='reports'?<InventoryReports locations={locations}/>:null}
      {inventorySection==='tasks'?taskWorkflow?<section className="inventory-task-owner"><IconButton icon={ArrowLeft} label="Back to My work" onClick={closeTaskOwner} />{taskWorkflow.kind==='custody'?<InventoryCustodyWorkspace locations={locations} actorId={actorId} initialTab="returns" initialLocationId={taskLocationId} initialCaseId={taskWorkflow.task.sourceId} hidePrimaryTabs/>:<InventoryStockTasks
          key={taskSection}
          locations={locations}
          actorId={actorId}
          kind={taskSection}
          initialPart={taskPart}
          initialLocationId={taskLocationId}
          initialTaskId={taskWorkflow.task?.sourceId || ""}
          onOpenLocations={openStockByLocation}
          onImportCount={openCountWorkflow}
        />}</section>:<InventoryTaskQueue locations={locations} onOpenTask={openTaskOwner}/>:null}

      {inventorySection === "stock" ? <><OperationalCollectionTabs
        className="inventory-stock-mode-tabs"
        ariaLabel="Inventory stock view"
        activeId={stockMode}
        onChange={changeStockMode}
        items={[{ id: "part", label: "By part" }, { id: "location", label: "By location" }]}
      />
      {stockMode === "part" ? <><OperationalCollectionTabs
        className="inventory-stock-tabs"
        ariaLabel="Filter stock by availability"
        activeId={stockFilter}
        onChange={setStockFilter}
        items={STOCK_FILTER_OPTIONS.map((option) => ({
          id: option.value,
          label: option.label,
          count: stockLoaded ? stockCounts[option.value] : "-",
          countLabel: `${stockLoaded ? stockCounts[option.value] : "Unavailable"} parts`,
        }))}
      />

      <OperationalCollectionToolbar className="inventory-toolbar">
        <label className="inventory-toolbar-field inventory-search-field"><span>Search</span><span className="inventory-search-control"><SearchMd /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Part number, description, manufacturer, or barcode" aria-label="Search inventory" /></span></label>
        <label className="inventory-toolbar-field inventory-scope-field"><span>Inventory view</span><Dropdown value={locationId} onChange={(event) => setLocationId(event.target.value)} aria-label="Inventory view"><option value="all">All locations</option><option value="master">Odoo master catalog</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</Dropdown></label>
        <label className="inventory-toolbar-field inventory-stock-sort"><span>Sort</span><Dropdown value={stockSort} onChange={(event) => setStockSort(event.target.value)} aria-label="Sort inventory stock">
          <option value="available_desc">Most available</option>
          <option value="low_stock_first">Low stock first</option>
          <option value="part_asc">Part number</option>
          <option value="reserved_desc">Most reserved</option>
          <option value="locations_desc">Most locations</option>
        </Dropdown></label>
      </OperationalCollectionToolbar>

      {error ? <p className="ops-error" role="alert">{error}</p> : null}
      {initialLoading ? <div className="inventory-empty"><RefreshCw01 className="loading-icon" /><strong>Loading inventory</strong></div> : null}

      {stockLoaded ? <>
        <OperationalCollectionResultHeader className="inventory-results-line" aria-live="polite">
          <span>{refreshing ? <><RefreshCw01 className="inventory-results-progress" aria-hidden="true" />Updating results</> : <><strong>{stockMeta.total}</strong> part{stockMeta.total === 1 ? "" : "s"} · {locationId === "master" ? "Odoo master catalog" : locationId === "all" ? "All locations" : locations.find((location) => location.id === locationId)?.name || "Selected location"}</>}</span>
          {(query || locationId !== "all" || stockFilter !== "all" || stockSort !== DEFAULT_STOCK_SORT) ? <Button type="button" onClick={clearStockView}>Reset view</Button> : null}
        </OperationalCollectionResultHeader>
        {items.length ? <OperationalCollectionTable
          className={`inventory-stock-table inventory-data-table${refreshing ? " is-refreshing" : ""}`}
          ariaLabel="Inventory parts"
          busy={refreshing}
          columns={[
            { id: "part", label: "Part" },
            { id: "on-hand", label: "Our on hand" },
            { id: "reserved", label: "Reserved" },
            { id: "available", label: "Our available" },
          ]}
        >
          {items.map((item) => {
            const state = stockState(item);
            const stateText = stockStateLabel(state);
            return <OperationalCollectionRow
            className="inventory-stock-row"
            key={stockItemKey(item)}
            aria-haspopup="dialog"
            ariaLabel={`Open details for ${item.partNumber}, ${stateText}, ${quantity(item.quantityAvailable)} ${item.uomCode} available`}
            onAction={() => openListedPart(item)}
          >
            <OperationalCollectionCell className="inventory-part-cell" label="Part"><strong>{item.partNumber}</strong><small>{item.description || "No part name"}</small></OperationalCollectionCell>
            <OperationalCollectionCell label="Usable on hand">{quantity(item.quantityOnHand)} {item.uomCode}</OperationalCollectionCell>
            <OperationalCollectionCell label="Reserved">{quantity(item.quantityReserved)} {item.uomCode}</OperationalCollectionCell>
            <OperationalCollectionCell className={`inventory-available-cell is-${state}`} label="Our available">
              {state === "out" ? <><strong>Out of stock</strong><small>{quantity(item.quantityOnHand)} {item.uomCode} on hand</small></>
                : state === "reserved" ? <><strong>{quantity(item.quantityAvailable)} {item.uomCode} available</strong><small>{quantity(item.quantityReserved)} {item.uomCode} reserved</small></>
                  : <><strong>{quantity(item.quantityAvailable)} {item.uomCode}</strong><small className="inventory-availability-meta"><span>{Number(item.locationCount || 0)} stocked location{Number(item.locationCount || 0) === 1 ? "" : "s"}</span>{item.lowStock ? <span className="inventory-availability-low">Low stock</span> : null}</small></>}
            </OperationalCollectionCell>
          </OperationalCollectionRow>})}
        </OperationalCollectionTable> : query || locationId !== "all" || stockFilter !== "all" ? <div className="inventory-empty"><Package /><strong>No matching stock</strong><p>Change the filters or use Reset view above.</p></div> : <div className="inventory-empty"><Package /><strong>No local inventory yet</strong><p>Review an invoice and choose “Add to inventory.”</p></div>}
        <Pagination currentPage={stockPage} pageCount={stockMeta.pageCount} setPage={setStockPage} total={stockMeta.total} label="parts" loading={refreshing} />
      </> : null}
      {canReconcileAuthority ? <InventoryAuthorityExceptionsPanel actorId={actorId} /> : null}
      </> : <InventoryLocationStockWorkspace locations={locations} initialShopId={stockLocationInitialShop} initialPositionId={stockLocationInitialPosition} refreshKey={refreshKey} canApplyInventoryCount={canApplyInventoryCount} onShopChange={setStockLocationInitialShop} onOpenPart={openLocationPart} onAddStock={({ part, shopId, positionId, positionPath }) => setReceivingPart({ ...(part || {}), receiptLocationId: shopId, receiptPositionId: positionId, receiptPositionPath: positionPath, lockReceiptLocation: true })} onOpenStartingInventory={(shopId) => { if (shopId) setLocationId(shopId); openCountWorkflow(); }} />}
      <SecondaryDetailPanel
        open={Boolean(selectedItem)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !partIdentityBusy && !partIdentityDirty) closeSelectedPart();
        }}
        eyebrow="Part details"
        title={selectedItem?.partNumber || "Part"}
        description={selectedItem?.description || "No description"}
        status={selectedItem ? <span className="inventory-part-header-price">Selling · {partHeaderPrice.scopeKey === partHeaderPriceScopeKey ? partHeaderPrice.label || "—" : "…"} / {selectedItem.uomCode || "unit"}</span> : null}
        footer={<Button type="button" onClick={closeSelectedPart} disabled={partIdentityBusy || partIdentityDirty}>Close</Button>}
        dismissable={!partIdentityBusy && !partIdentityDirty}
        closeDisabled={partIdentityBusy || partIdentityDirty}
        closeLabel={partIdentityBusy ? "Saving part details" : partIdentityDirty ? "Reset changes before closing" : "Close part details"}
      >
        {selectedItem ? <>
          <div className="inventory-part-detail-navigation">
            <nav className="inventory-part-detail-pages" aria-label="Part detail pages">
              {[{ id: "stock", label: "Stock" }, { id: "prices", label: "Prices" }, { id: "activity", label: "Audit log" }, { id: "details", label: "Details" }].map((page) => <button key={page.id} type="button" aria-current={partDetailPage === page.id ? "page" : undefined} disabled={partIdentityDirty && page.id !== "details"} onClick={() => { setPartDetailPage(page.id); setShelvingOpen(false); }}>{page.label}</button>)}
            </nav>
            {partDetailPage === "stock" ? <Button className="inventory-part-detail-primary-action" type="button" variant="primary" onClick={() => setReceivingPart(selectedLocation ? { ...selectedItem, receiptLocationId: selectedLocation.locationId, receiptPositionId: selectedPositionContext?.positionId || "", receiptPositionPath: selectedPositionContext?.positionPath || selectedLocation.locationName, lockReceiptLocation: true } : selectedItem)} disabled={!selectedItem.trackingMode}>Add stock</Button> : null}
          </div>

          {partDetailPage === "stock" ? selectedLocation && shelvingOpen ? <>
            <div className="inventory-part-detail-toolbar"><IconButton icon={ArrowLeft} label="Back to location" onClick={() => setShelvingOpen(false)} /></div>
            <PartPositionsPanel item={selectedItem} location={selectedLocation} initialSourcePositionId={selectedPositionContext?.positionId || ""} onChanged={() => setRefreshKey((value) => value + 1)} />
          </> : selectedLocation ? <>
            <div className="inventory-part-detail-toolbar">
              <div className="inventory-part-detail-toolbar-context"><IconButton icon={ArrowLeft} label="Back to all locations" onClick={() => setSelectedLocationId("")} /><div><h3>{selectedLocation.locationName}</h3><p>{selectedPositionContext?.positionPath || ""}</p></div></div>
              <PartLocationSettings part={selectedItem} location={selectedLocation} onOpenShelves={() => setShelvingOpen(true)} onDamage={(sourceLocationId) => openStockDamage(selectedItem, sourceLocationId)} onTransfer={(sourceLocationId) => openStockTransfer(selectedItem, sourceLocationId)} onSaved={() => setRefreshKey((value) => value + 1)} />
            </div>
            {selectedItem.trackingMode === "quantity" || selectedItem.trackingMode === "measured_bulk" ? <div className="inventory-part-location-summary">
              <section className="inventory-part-location-balance" aria-label={`${selectedLocation.locationName} stock balance`}>
                <div className="inventory-detail-metrics">
                  <div><span>On hand</span><strong>{quantity(selectedLocation.quantityOnHand)} {selectedItem.uomCode}</strong></div>
                  <div><span>Reserved</span><strong>{quantity(selectedLocation.quantityReserved)} {selectedItem.uomCode}</strong></div>
                  <div><span>Available</span><strong>{quantity(selectedLocation.quantityAvailable)} {selectedItem.uomCode}</strong></div>
                </div>
              </section>
              <section className="inventory-shop-usage" aria-labelledby="inventory-shop-usage-heading">
                <header><div><h3 id="inventory-shop-usage-heading">Used on Workorders</h3><p>{selectedLocation.locationName}</p></div><Button type="button" onClick={() => setPartDetailPage("activity")}>View full audit log</Button></header>
                <StockMovementHistory partId={selectedItem.catalogPartId} locationId={selectedLocation.locationId} view="workorder" emptyMessage="No Workorder usage at this shop." refreshKey={refreshKey} />
              </section>
            </div> : <>
              <PartSerializationPanel
                item={selectedItem}
                location={selectedLocation}
                companyId={selectedItem.companyId}
                actorId={actorId}
                onInventoryChanged={() => setRefreshKey((value) => value + 1)}
                onMarkDamaged={(unit) => openStockDamage(selectedItem, selectedLocation.locationId, unit.serialNumber)}
                showAddAction={false}
              />
              <div className="inventory-part-location-audit-action"><Button type="button" onClick={() => setPartDetailPage("activity")}>View full audit log</Button></div>
            </>}
          </> : <>
            <section className="inventory-part-stock-overview" aria-label="Inventory summary">
              {!selectedItem.trackingMode ? <p>Review tracking in Details before adding stock.</p> : null}
              <div className="inventory-detail-metrics">
                <div><span>On hand</span><strong>{quantity(selectedItem.quantityOnHand)} {selectedItem.uomCode}</strong></div>
                <div><span>Our reserved</span><strong>{quantity(selectedItem.quantityReserved)} {selectedItem.uomCode}</strong></div>
                <div><span>Available</span><strong>{quantity(selectedItem.quantityAvailable)} {selectedItem.uomCode}</strong></div>
              </div>
              {Number(selectedItem.odooQuantityOnHand || 0) > 0 ? <p className="inventory-detail-provider-stock">Odoo · read-only · {quantity(selectedItem.odooQuantityOnHand)} {selectedItem.uomCode}</p> : null}
            </section>
            <SecondaryDetailSection title="Locations">
              {stockedLocations.length ? <div className="inventory-detail-locations">{stockedLocations.map(partLocationRow)}</div> : <p className="inventory-detail-empty">No stock at any location.</p>}
              {otherLocations.length ? <details className="inventory-detail-other-locations"><summary>Other locations <span>{otherLocations.length}</span></summary><div className="inventory-detail-locations">{otherLocations.map(partLocationRow)}</div></details> : null}
            </SecondaryDetailSection>
          </> : null}

          {partDetailPage === "prices" ? <PartCommercialDetails key={`${selectedItem.catalogPartId}:${selectedLocation?.locationId || "company-defaults"}`} part={selectedItem} location={selectedLocation || undefined} onChanged={() => setRefreshKey((value) => value + 1)} /> : null}

          {partDetailPage === "activity" ? <section className="inventory-stock-activity-page" aria-labelledby="inventory-audit-log-heading">
            <header className="inventory-audit-log-heading"><div><h3 id="inventory-audit-log-heading">Audit log</h3><p>{selectedLocation ? `${selectedLocation.locationName} · Filtered to this shop` : "All locations · Company-wide history"}</p></div>{selectedLocation ? <Button type="button" onClick={() => setSelectedLocationId("")}>Show all locations</Button> : null}</header>
            <StockMovementHistory partId={selectedItem.catalogPartId} locationId={selectedLocation?.locationId} refreshKey={refreshKey} />
          </section> : null}

          {partDetailPage === "details" ? <section className="inventory-part-identity" aria-label="Part details">
            {partIdentityRefreshPending ? <p role="status">Refreshing…</p> : null}
            <PartIdentityEditor
              key={`${selectedItem.catalogPartId}:${selectedItem.version}`}
              part={selectedItem}
              onEditStateChange={onPartIdentityEditStateChange}
              onReload={reloadPartIdentity}
              onSaved={handlePartIdentitySaved}
            />
          </section> : null}
        </> : null}
      </SecondaryDetailPanel>
      </> : null}
      </>}
      {receivingPart ? <AddInventoryStockDialog part={receivingPart} actorId={actorId} locations={locations.filter((location) => !receivingPart.companyId || !location.companyId || location.companyId === receivingPart.companyId)} initialLocationId={receivingPart.receiptLocationId || (locationId !== "all" && locationId !== "master" ? locationId : "")} initialPositionId={receivingPart.receiptPositionId || ""} lockLocation={Boolean(receivingPart.lockReceiptLocation)} locationContextLabel={receivingPart.receiptPositionPath || ""} onClose={() => setReceivingPart(null)} onReceived={() => setRefreshKey((value) => value + 1)} /> : null}
    </OperationalCollectionPage>
  );
}
