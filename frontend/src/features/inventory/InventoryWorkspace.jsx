import { InventoryLocationStockWorkspace } from "./InventoryLocationStockWorkspace.jsx";
import { PartPositionsPanel } from "./PartPositionsPanel.jsx";
import { PartCommercialDetails } from "./PartCommercialDetails.jsx";
import './inventory-tables.css';
import { InventoryPurchases } from './InventoryPurchases.jsx';
import { consumePurchaseReceiptHandoff } from './purchase-receipt-handoff.js';
import { InventoryStockTasks } from './InventoryStockTasks.jsx';
import { InventoryReports } from './InventoryReports.jsx';
import { InventoryTaskQueue } from './InventoryTaskQueue.jsx';
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, MarkerPin01, Package, Plus, RefreshCw01, SearchMd, SwitchVertical01, UploadCloud02 } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { IconButton } from "../../components/ui/IconButton.jsx";
import { ContextBreadcrumbs } from "../../components/ui/ContextBreadcrumbs.jsx";
import { isPlainPrimaryActivation } from "../../components/ui/context-navigation.js";
import { SeverityPill } from "../../components/ui/SeverityPill.jsx";
import { CheckpointCollection } from "../../components/ui/CheckpointCollection.jsx";
import { useCheckpointPages } from "../../components/operations/useCheckpointPages.js";
import { readCheckpointPosition } from "../../components/operations/checkpoint-position.js";
import { SecondaryDetailPanel, SecondaryDetailSection } from "../../components/ui/SecondaryDetailPanel.jsx";
import {
  OperationalCollectionCell,
  OperationalCollectionPage,
  OperationalCollectionResultHeader,
  OperationalCollectionRow,
  OperationalCollectionSectionHeader,
  OperationalCollectionTabs,
  OperationalCollectionToolbar,
  OperationalCollectionTable,
} from "../../components/operations/OperationalCollectionPage.jsx";
import { api } from "../../lib/api.js";
import { InvoiceExtractionWorkspace } from "../office/InvoiceExtractionWorkspace.jsx";
import { PartIdentityEditor } from "./PartIdentityEditor.jsx";
import { PartLocationSettings } from "./PartLocationSettings.jsx";
import { CreateInventoryPartDialog } from "./CreateInventoryPartDialog.jsx";
import { AddInventoryStockDialog } from "./AddInventoryStockDialog.jsx";
import { StockMovementHistory } from "./StockMovementHistory.jsx";
import { PartSerializationPanel } from "./PartSerializationPanel.jsx";
import { InventoryCustodyWorkspace } from "./InventoryCustodyWorkspace.jsx";
import {
  DEFAULT_STOCK_SORT,
  STOCK_FILTER_OPTIONS,
  stockState,
  stockStateLabel,
  stockIssueLabel,
  stockIssuePill,
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
const INVENTORY_SECTIONS = [{ id: "stock", label: "Stock" }, { id: "purchases", label: "Purchasing" }, { id: "tasks", label: "Tasks" }, { id: "reports", label: "Reports" }];
const normalizeInventorySection = (section) => section === "inbound" ? "purchases" : section;

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

export function InventoryWorkspace({ actorId = "", canApplyInventoryCount = false, presentation = "page", activeSection = "", onSectionChange = null, onSectionTitleChange = null, onSectionActionsChange = null, showSectionNavigation = true, showSectionNavigationOnPhone = false }) {
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
  const [invoiceRunId, setInvoiceRunId] = useState(() => initialParams.get("invoiceRun") || "");
  const [countUploadOpen, setCountUploadOpen] = useState(false);
  const [workflowDetail, setWorkflowDetail] = useState(null);
  const [query, setQuery] = useState("");
  const [locationId, setLocationId] = useState("all");
  const [purchaseLocationId, setPurchaseLocationId] = useState(() => initialParams.get("taskLocation") || "");
  const [stockFilter, setStockFilter] = useState("all");
  const [stockSort, setStockSort] = useState(DEFAULT_STOCK_SORT);
  const [stockMode, setStockMode] = useState(() => initialParams.get("stockMode") === "location" ? "location" : "part");
  const [locations, setLocations] = useState([]);
  const [browseLocations, setBrowseLocations] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedStockKey, setSelectedStockKey] = useState("");
  const [selectedLocationPart, setSelectedLocationPart] = useState(null);
  const [partStockError, setPartStockError] = useState("");
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
  const [inventorySection, setInventorySection] = useState(() => {
    const requested = normalizeInventorySection(activeSection || initialParams.get("inventorySection"));
    return INVENTORY_SECTIONS.some((section) => section.id === requested) ? requested : "stock";
  });
  const [inboundReceiptHandoff, setInboundReceiptHandoff] = useState(null);
  const consumeInboundReceiptHandoff = useCallback((key) => {
    setInboundReceiptHandoff((current) => consumePurchaseReceiptHandoff(current, key));
  }, []);
  const [reportPurchaseOrderId, setReportPurchaseOrderId] = useState(() => initialParams.get("purchaseOrderId") || "");
  const [reportPurchaseOrderNumber, setReportPurchaseOrderNumber] = useState(() => initialParams.get("purchaseOrderNumber") || "");
  const [reportPurchaseOrderLocationId, setReportPurchaseOrderLocationId] = useState(() => initialParams.get("taskLocation") || "");
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

  useEffect(() => {
    const nextSection = normalizeInventorySection(activeSection);
    if (!INVENTORY_SECTIONS.some((section) => section.id === nextSection) || nextSection === inventorySection) return;
    setInventorySection(nextSection);
    setTaskWorkflow(null);
    setInboundSource({ receiptId: "", deliveryId: "" });
  }, [activeSection, inventorySection]);

  function selectInventorySection(nextSection) {
    const normalizedSection = normalizeInventorySection(nextSection);
    setInventorySection(normalizedSection);
    onSectionChange?.(normalizedSection);
  }

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      api("/api/office/template"),
      api("/api/office/inventory/browse-locations"),
    ]).then(([templateResult, browseResult]) => {
      if (!active) return;
      const writable = templateResult.status === "fulfilled"
        ? (templateResult.value.locations || []).map((entry) => entry.location).filter(Boolean)
        : [];
      setLocations(writable);
      setBrowseLocations(browseResult.status === "fulfilled"
        ? browseResult.value.locations || []
        : writable.map((location) => ({ ...location, companyId: location.company_id, canManage: true, canManageCompany: false })));
    });
    return () => { active = false; };
  }, []);

  const [stockQuery, setStockQuery] = useState(query);
  useEffect(() => {
    const timer = window.setTimeout(() => setStockQuery(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  const stockQueryKey = JSON.stringify(["price-attention-v1", actorId, locationId, stockQuery.trim(), stockFilter, stockSort]);
  const initialStockPage = useMemo(() => readCheckpointPosition(`inventory-stock:${stockQueryKey}`)?.page || 1, [stockQueryKey]);
  const stockQueue = useCheckpointPages({
    queryKey: stockQueryKey, refreshKey, getItemKey: stockItemKey, initialPage: initialStockPage,
    enabled: !invoiceWorkflowOpen && !countWorkflowOpen && inventorySection === "stock" && stockMode === "part",
    fetchPage: async (page, { signal }) => {
      const params = new URLSearchParams({ limit: "20", page: String(page), sort: stockSort });
      if (stockQuery.trim()) params.set("q", stockQuery.trim());
      if (stockFilter !== "all") params.set("availability", stockFilter);
      if (locationId === "master") params.set("scope", "master");
      else if (locationId !== "all") params.set("locationId", locationId);
      const result = await api(`/api/office/inventory/stock?${params}`, { signal });
      return { ...result, page, meta: { counts: result.counts } };
    },
  });
  const items = useMemo(() => stockQueue.pages.flatMap((batch) => batch.items), [stockQueue.pages]);
  const stockLoaded = stockQueue.pages.length > 0;
  const loading = stockQueue.loading || stockQueue.loadingMore;
  const error = stockQueue.error?.message || "";
  const stockMeta = { total: stockQueue.total, counts: stockQueue.pages[0]?.meta?.counts || { all: 0, available: 0, reserved: 0, out: 0 } };
  const stockCounts = stockMeta.counts;
  const initialLoading = stockQueue.loading && !stockLoaded;
  const refreshing = stockQueue.loadingMore;
  const selectedItem = useMemo(() => {
    const item = (selectedLocationPart && stockItemKey(selectedLocationPart) === selectedStockKey ? selectedLocationPart : null)
      || items.find((entry) => stockItemKey(entry) === selectedStockKey);
    return item && partIdentityOverride?.catalogPartId === item.catalogPartId
      ? { ...item, ...partIdentityOverride, issues: item.issues, locations: item.locations } : item;
  }, [items, partIdentityOverride, selectedLocationPart, selectedStockKey]);
  // Keep the open part current even when fixing its rates moves it off this batch.
  const selectedPartId = selectedLocationPart?.catalogPartId;
  useEffect(() => {
    if (!selectedStockKey || !selectedPartId) return undefined;
    const controller = new AbortController();
    setPartStockError("");
    const params = new URLSearchParams({ catalogPartId: selectedPartId, limit: "1" });
    const shopId = selectedPositionContext?.shopId || locationId;
    if (shopId === "master") params.set("scope", "master");
    else if (shopId && shopId !== "all") params.set("locationId", shopId);
    api(`/api/office/inventory/stock?${params}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        const item = result.items?.find((entry) => entry.catalogPartId === selectedPartId);
        if (item) setSelectedLocationPart(item);
        else setPartStockError("This part is no longer available in this view. Close it and refresh Stock.");
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setPartStockError(failure.message || "Could not refresh this part's status.");
      });
    return () => controller.abort();
  }, [selectedStockKey, selectedPartId, refreshKey, locationId, selectedPositionContext?.shopId]);
  const noStockLocations = selectedItem?.trackingMode === "no_stock"
    ? browseLocations.filter((location) => location.companyId === selectedItem.companyId)
    : [];
  const selectedNoStockLocation = noStockLocations.find((location) => location.id === selectedLocationId);
  const selectedLocation = selectedItem?.locations.find((location) => location.locationId === selectedLocationId)
    || (selectedNoStockLocation ? { locationId: selectedNoStockLocation.id, locationName: selectedNoStockLocation.name } : null);
  const manageableLocationIds = useMemo(() => new Set(locations.map((location) => location.id)), [locations]);
  const manageableCompanyIds = useMemo(() => new Set(browseLocations.filter((location) => location.canManageCompany).map((location) => location.companyId)), [browseLocations]);
  const selectedCompanyCanManage = Boolean(selectedItem?.companyId && manageableCompanyIds.has(selectedItem.companyId));
  const selectedLocationReadOnly = Boolean(selectedLocation && !manageableLocationIds.has(selectedLocation.locationId));
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
    const partPath = `/api/office/inventory/parts/${encodeURIComponent(selectedItem.catalogPartId)}`;
    const commercialRequest = api(`${partPath}/commercial?${params}`);
    const policyRequest = selectedItem.trackingMode === "no_stock"
      ? api(`${partPath}/selling-policy${selectedLocation?.locationId ? `?${new URLSearchParams({ locationId: selectedLocation.locationId })}` : ""}`)
      : Promise.resolve(null);
    Promise.all([commercialRequest, policyRequest])
      .then(([commercial, sellingPolicy]) => {
        if (!active) return;
        const price = effectiveSellingPrice(commercial, Boolean(selectedLocation?.locationId), sellingPolicy);
        const view = configuredPriceView(price);
        setPartHeaderPrice({ scopeKey, label: view.label === "Unknown" ? "—" : view.label });
      })
      .catch(() => {
        if (active) setPartHeaderPrice({ scopeKey, label: "—" });
      });
    return () => { active = false; };
  }, [partHeaderPriceScopeKey, refreshKey, selectedItem?.catalogPartId, selectedItem?.trackingMode, selectedLocation?.locationId]);

  function closeSelectedPart() {
    setSelectedStockKey("");
    setSelectedLocationPart(null);
    setSelectedPositionContext(null);
  }

  function openListedPart(item) {
    setSelectedLocationPart(item);
    setSelectedPositionContext(null);
    setSelectedStockKey(stockItemKey(item));
  }

  async function openLocationPart({ item, shopId, positionId, positionPath, canStore }) {
    const catalogPartId = item.catalogPartId || item.partId || item.id;
    const params = new URLSearchParams({ catalogPartId, locationId: shopId, limit: "1" });
    const result = await api(`/api/office/inventory/stock?${params}`);
    const fullItem = (result.items || []).find((entry) => entry.catalogPartId === catalogPartId);
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
    selectInventorySection('tasks');
    closeSelectedPart();
  }

  function openStockDamage(part, sourceLocationId, serialNumber = "") {
    setTaskPart(serialNumber ? { ...part, damageSerialNumber: serialNumber } : part);
    setTaskLocationId(sourceLocationId);
    setTaskSection("damage");
    setTaskWorkflow({ kind: "stock" });
    selectInventorySection("tasks");
    closeSelectedPart();
  }

  function partLocationRow(location) {
    const canManage = manageableLocationIds.has(location.locationId);
    return <div className="inventory-detail-location-row" key={location.locationId}>
      <button type="button" onClick={() => setSelectedLocationId(location.locationId)}>
        <div><span className="inventory-detail-location-name"><strong>{location.locationName}</strong>{!canManage ? <span className="inventory-view-only-badge">View only</span> : null}</span><small><b>{quantity(location.quantityAvailable)} {selectedItem.uomCode}</b> available{Number(location.odooQuantityOnHand || 0) > 0 ? <> · {quantity(location.odooQuantityOnHand)} {selectedItem.uomCode} in Odoo</> : null}</small></div>
        <ChevronRight aria-hidden="true" />
      </button>
      {canManage ? <PartLocationSettings part={selectedItem} location={location} onOpenShelves={() => { setSelectedLocationId(location.locationId); setShelvingOpen(true); }} onDamage={(sourceLocationId) => openStockDamage(selectedItem, sourceLocationId)} onTransfer={(sourceLocationId) => openStockTransfer(selectedItem, sourceLocationId)} onSaved={() => setRefreshKey((value) => value + 1)} /> : null}
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
    const refreshedItem = selectedLocationPart?.catalogPartId === partIdentityRefreshPending.catalogPartId
      ? selectedLocationPart : items.find((item) => item.catalogPartId === partIdentityRefreshPending.catalogPartId);
    if (!hasRefreshedPartIdentityVersion(refreshedItem, partIdentityRefreshPending)) return;
    setPartIdentityRefreshPending(null);
    window.requestAnimationFrame(() => document.getElementById("inventory-part-name")?.focus({ preventScroll: true }));
  }, [items, selectedLocationPart, partIdentityRefreshPending]);

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
    const resolvedLocationId = requestedLocationId && locations.some((location) => location.id === requestedLocationId) ? requestedLocationId : "";
    if (resolvedLocationId) {
      setLocationId(requestedLocationId);
      setPurchaseLocationId(requestedLocationId);
    }
    const url = inventoryUrl({ invoiceRun, upload: !invoiceRun });
    url.searchParams.set("inventorySection", "purchases");
    if (resolvedLocationId) url.searchParams.set("taskLocation", resolvedLocationId);
    for (const key of ["receiptId", "deliveryId", "approvalId", "purchaseOrderId", "purchaseOrderNumber"]) url.searchParams.delete(key);
    window.history.replaceState({}, "", url);
    setInboundSource({ receiptId: "", deliveryId: "" });
    setReportPurchaseOrderId("");
    setReportPurchaseOrderNumber("");
    setReportPurchaseOrderLocationId("");
    setInvoiceRunId(invoiceRun);
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
    setInvoiceRunId("");
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

  function backFromInvoiceWorkflow() {
    if (workflowDetail?.onBack) workflowDetail.onBack();
    else closeInvoiceWorkflow();
  }

  function clearStockView() {
    setQuery("");
    setLocationId("all");
    setStockFilter("all");
    setStockSort(DEFAULT_STOCK_SORT);
  }

  const inventoryTitle = invoiceWorkflowOpen
    ? "Invoice intake"
    : countWorkflowOpen
      ? "Starting inventory"
      : !showSectionNavigation && presentation === "page"
        ? INVENTORY_SECTIONS.find((section) => section.id === inventorySection)?.label || "Stock"
        : "";
  const inventorySubtitle = invoiceWorkflowOpen
    ? ""
    : countWorkflowOpen
      ? "Import and review starting-inventory count sheets."
      : "";
  const inventoryLeading = invoiceWorkflowOpen ? (
    <Button type="button" className="inventory-invoice-back-button" icon={ArrowLeft} onClick={backFromInvoiceWorkflow}>Back</Button>
  ) : countWorkflowOpen ? <ContextBreadcrumbs
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
  const stockActions = <>
    <Button type="button" variant="primary" onClick={() => setReceivingPart({})} disabled={!locations.length}>Add stock</Button>
    <IconButton className="inventory-refresh-button" icon={RefreshCw01} label="Refresh inventory" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading} />
    <Button type="button" icon={Plus} onClick={() => setCreatePartOpen(true)} disabled={!locations.length}>New part</Button>
  </>;
  const taskActions = !taskWorkflow ? <Button type="button" onClick={openPhysicalCountTasks}>Physical counts</Button> : null;
  const sectionActions = inventorySection === "stock" ? stockActions : inventorySection === "tasks" ? taskActions : null;
  const inventoryActions = countWorkflowOpen ? (
    <Button type="button" variant="primary" icon={UploadCloud02} onClick={() => setCountUploadOpen(true)}>Import count sheet</Button>
  ) : invoiceWorkflowOpen ? (
    !workflowDetail ? <IconButton className="inventory-invoice-upload-button" icon={UploadCloud02} label="Upload invoices" aria-haspopup="dialog" onClick={() => setInvoiceUploadOpen(true)} /> : null
  ) : !showSectionNavigation && !onSectionActionsChange ? sectionActions : null;

  useEffect(() => {
    onSectionActionsChange?.(invoiceWorkflowOpen || countWorkflowOpen ? null : sectionActions);
  }, [countWorkflowOpen, inventorySection, invoiceWorkflowOpen, loading, locations.length, onSectionActionsChange, taskWorkflow]);

  useEffect(() => () => onSectionActionsChange?.(null), [onSectionActionsChange]);

  useEffect(() => {
    onSectionTitleChange?.(
      invoiceWorkflowOpen
        ? "Invoice intake"
        : countWorkflowOpen
          ? "Starting inventory"
          : INVENTORY_SECTIONS.find((section) => section.id === inventorySection)?.label || "Stock",
    );
  }, [countWorkflowOpen, inventorySection, invoiceWorkflowOpen, onSectionTitleChange]);

  function changeInventorySection(nextSection) {
    nextSection = normalizeInventorySection(nextSection);
    selectInventorySection(nextSection);
    setTaskWorkflow(null);
    setInboundSource({ receiptId: "", deliveryId: "" });
    setReportPurchaseOrderId("");
    setReportPurchaseOrderNumber("");
    setReportPurchaseOrderLocationId("");
    const url = new URL(window.location.href);
    url.searchParams.set("inventorySection", nextSection);
    for (const key of ["taskOwner", "taskId", "taskLocation", "reuseCaseId", "positionId", "receiptId", "deliveryId", "approvalId", "purchaseOrderId", "purchaseOrderNumber", "stockMode", "stockAction", "queueTaskType", "queueTaskId", "queueTaskLocation"]) url.searchParams.delete(key);
    window.history.replaceState({}, "", url);
  }

  function openExactTaskUrl(values) {
    const url = new URL(window.location.href);
    for (const key of ["taskOwner", "taskId", "taskLocation", "reuseCaseId", "positionId", "receiptId", "deliveryId", "approvalId", "purchaseOrderId", "purchaseOrderNumber", "stockMode", "stockAction", "queueTaskType", "queueTaskId", "queueTaskLocation"]) url.searchParams.delete(key);
    for (const [key, value] of Object.entries(values)) if (value) url.searchParams.set(key, value);
    window.history.replaceState({}, "", url);
  }

  function changePurchaseLocation(nextLocationId, { preserveSource = false, preservePurchaseOrder = false } = {}) {
    if (!locations.some((location) => location.id === nextLocationId)) return;
    setPurchaseLocationId(nextLocationId);
    const url = new URL(window.location.href);
    url.searchParams.set("inventorySection", "purchases");
    url.searchParams.set("taskLocation", nextLocationId);
    if (!preservePurchaseOrder) {
      url.searchParams.delete("purchaseOrderId");
      url.searchParams.delete("purchaseOrderNumber");
      setReportPurchaseOrderId("");
      setReportPurchaseOrderNumber("");
      setReportPurchaseOrderLocationId("");
    }
    if (!preserveSource) {
      for (const key of ["receiptId", "deliveryId", "approvalId"]) url.searchParams.delete(key);
      setInboundSource({ receiptId: "", deliveryId: "" });
      setInboundReceiptHandoff(null);
    }
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
    if (["position_recount", "position_count_review"].includes(task.sourceType)) { const positionId = task.actionTarget?.positionId || new URL(task.deepLink, window.location.href).searchParams.get("positionId") || ""; setStockLocationInitialShop(location); setStockLocationInitialPosition(positionId); setStockMode("location"); selectInventorySection("stock"); openExactTaskUrl({ inventorySection: "stock", stockMode: "location", positionId, taskLocation: location }); return; }
    if (task.sourceType === "invoice_po_decision") { openInvoiceWorkflow(task.sourceId, location); return; }
    if (task.sourceType === "missing_invoice") { setPurchaseLocationId(location); setInboundSource({ receiptId: task.sourceId, deliveryId: "" }); selectInventorySection("purchases"); openExactTaskUrl({ inventorySection: "purchases", receiptId: task.sourceId, taskLocation: location }); return; }
    if (task.sourceType === "receipt_exception") { setPurchaseLocationId(location); setInboundSource({ receiptId: "", deliveryId: task.sourceId }); selectInventorySection("purchases"); openExactTaskUrl({ inventorySection: "purchases", deliveryId: task.sourceId, taskLocation: location }); return; }
    window.location.assign(task.deepLink);
  }

  function openStockByLocation(shopId = "") {
    setStockLocationInitialShop(shopId);
    setStockMode("location");
    selectInventorySection("stock");
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
    selectInventorySection("tasks");
    openExactTaskUrl({ inventorySection: "tasks", taskOwner: "count" });
  }

  const invoiceLocationId = inventorySection === "purchases" ? purchaseLocationId || locationId : locationId;

  return (
    <OperationalCollectionPage
      className={`${presentation === "page" ? "admin-content " : ""}inventory-workspace${invoiceWorkflowOpen || countWorkflowOpen ? " is-invoice-workflow" : " is-section-root"}`}
      presentation={presentation}
      title={inventoryTitle}
      subtitle={inventorySubtitle}
      leading={inventoryLeading}
      actions={inventoryActions}
      showTitle={presentation !== "embedded"}
    >
      {createPartOpen ? <CreateInventoryPartDialog
        locationId={locations.some((location) => location.id === locationId) ? locationId : ""}
        locations={locations}
        onClose={() => setCreatePartOpen(false)}
        onCreated={(part) => { setQuery(part.partNumber); setRefreshKey((value) => value + 1); }}
      /> : null}

      {invoiceWorkflowOpen ? <InvoiceExtractionWorkspace embedded availableLocations={locations} initialLocationId={locations.some((location) => location.id === invoiceLocationId) ? invoiceLocationId : ""} initialRunId={invoiceRunId} uploadOpen={invoiceUploadOpen} onUploadOpenChange={setInvoiceUploadOpen} onContextChange={updateWorkflowDetail} /> : countWorkflowOpen ? <Suspense fallback={<div className="inventory-empty"><Package /><strong>Loading count sheets</strong></div>}><InventoryCountImportPanel locations={locations} initialImportId={initialParams.get("countImport") || ""} uploadOpen={countUploadOpen} onUploadOpenChange={setCountUploadOpen} canApplyInventoryCount={canApplyInventoryCount} onApplied={() => setRefreshKey((value) => value + 1)} onContextChange={updateWorkflowDetail} /></Suspense> : <>

      {showSectionNavigation ? <OperationalCollectionSectionHeader ariaLabel="Other inventory sections" activeId={inventorySection} onChange={changeInventorySection} items={INVENTORY_SECTIONS} actions={sectionActions} headingLevel={presentation === "embedded" ? 2 : 1} showHeading={presentation !== "embedded"} /> : <>
        {showSectionNavigationOnPhone ? <div className="inventory-phone-section-navigation"><OperationalCollectionSectionHeader ariaLabel="Inventory sections" activeId={inventorySection} onChange={changeInventorySection} items={INVENTORY_SECTIONS} headingLevel={presentation === "embedded" ? 2 : 1} showHeading={false} /></div> : null}
      </>}
      <section className="operational-collection-surface inventory-section-surface" aria-label={`${INVENTORY_SECTIONS.find((section) => section.id === inventorySection)?.label || "Stock"} workspace`}>
      {inventorySection==='purchases'?<InventoryPurchases locations={locations} actorId={actorId} view={inventorySection} initialReceiptHandoff={inboundReceiptHandoff} onReceiptHandoffConsumed={consumeInboundReceiptHandoff} initialPurchaseOrderId={reportPurchaseOrderId} initialPurchaseOrderNumber={reportPurchaseOrderNumber} initialPurchaseLocationId={reportPurchaseOrderLocationId} initialLocationId={purchaseLocationId} onLocationChange={changePurchaseLocation} initialInboundSource={inboundSource} initialInboundOpen={initialParams.get("inventorySection")==="inbound"||activeSection==="inbound"} initialInboundLocationId={initialParams.get("taskLocation")||""} onInvoice={(requestedLocationId,invoiceRunId="")=>openInvoiceWorkflow(invoiceRunId,requestedLocationId)} onStock={(requestedLocationId)=>setReceivingPart({receiptLocationId:requestedLocationId})}/>:null}
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

      {inventorySection === "stock" ? <>
      <OperationalCollectionTabs
        className="inventory-stock-mode-tabs"
        ariaLabel="Inventory stock view"
        activeId={stockMode}
        onChange={changeStockMode}
        items={[{ id: "part", label: "By part" }, { id: "location", label: "By location" }]}
      />
      {stockMode === "part" ? <>
      <OperationalCollectionToolbar className="inventory-toolbar inventory-stock-toolbar">
        <label className="inventory-toolbar-field inventory-queue-field"><span>Queue</span><Dropdown value={stockFilter} onChange={(event) => setStockFilter(event.target.value)} aria-label="Filter stock by availability">{STOCK_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}{stockLoaded ? ` (${stockCounts[option.value]})` : ""}</option>)}</Dropdown></label>
        <label className="inventory-toolbar-field inventory-search-field"><span>Search</span><span className="inventory-search-control"><SearchMd /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Part number, description, manufacturer, or barcode" aria-label="Search inventory" /></span></label>
        <div className="inventory-stock-icon-controls">
        <Dropdown icon={MarkerPin01} className={locationId !== "all" ? "is-active" : ""} popoverClassName="inventory-stock-control-popover" value={locationId} onChange={(event) => setLocationId(event.target.value)} aria-label="Inventory view" title={`Location: ${locationId === "all" ? "All locations" : locationId === "master" ? "Odoo master catalog" : browseLocations.find((location) => location.id === locationId)?.name || "Selected location"}`}><option value="all">All locations</option><option value="master">Odoo master catalog</option>{browseLocations.map((location) => <option key={location.id} value={location.id}>{location.name}{location.canManage === false ? " · View only" : ""}</option>)}</Dropdown>
        <Dropdown icon={SwitchVertical01} className={stockSort !== DEFAULT_STOCK_SORT ? "is-active" : ""} popoverClassName="inventory-stock-control-popover" value={stockSort} onChange={(event) => setStockSort(event.target.value)} aria-label="Sort inventory stock" title="Sort inventory stock">
          <option value="available_desc">Most available</option>
          <option value="low_stock_first">Low stock first</option>
          <option value="part_asc">Part number</option>
          <option value="reserved_desc">Most reserved</option>
          <option value="locations_desc">Most locations</option>
        </Dropdown>
        </div>
      </OperationalCollectionToolbar>

      {error ? <p className="ops-error" role="alert">{error}</p> : null}
      {initialLoading ? <div className="inventory-stock-skeleton" role="status" aria-label="Loading inventory" aria-busy="true"><OperationalCollectionTable className="inventory-stock-table" ariaLabel="Inventory loading" columns={[{ id: "part", label: "Part" }, { id: "on-hand", label: "Our on hand" }, { id: "reserved", label: "Reserved" }, { id: "available", label: "Our available" }]}>{Array.from({ length: 10 }, (_, index) => <OperationalCollectionRow className="inventory-stock-row" key={index}><OperationalCollectionCell><span className="inventory-skeleton-bar is-part" /><span className="inventory-skeleton-bar is-description" /></OperationalCollectionCell>{[0, 1, 2].map((cell) => <OperationalCollectionCell key={cell}><span className="inventory-skeleton-bar" /></OperationalCollectionCell>)}</OperationalCollectionRow>)}</OperationalCollectionTable></div> : null}

      {stockLoaded ? <>
        <OperationalCollectionResultHeader className="inventory-results-line" aria-live="polite">
          <span>{refreshing ? <><RefreshCw01 className="inventory-results-progress" aria-hidden="true" />Updating results</> : <><strong>{stockMeta.total}</strong> part{stockMeta.total === 1 ? "" : "s"} · {locationId === "master" ? "Odoo master catalog" : locationId === "all" ? "All locations" : browseLocations.find((location) => location.id === locationId)?.name || "Selected location"}</>}</span>
          {(query || locationId !== "all" || stockFilter !== "all" || stockSort !== DEFAULT_STOCK_SORT) ? <Button type="button" onClick={clearStockView}>Reset view</Button> : null}
        </OperationalCollectionResultHeader>
        <CheckpointCollection queue={stockQueue} label="parts" pageSize={20} getItemKey={stockItemKey}
          storageKey={`inventory-stock:${stockQueryKey}`}
          className="inventory-stock-table inventory-data-table"
          ariaLabel="Inventory parts"
          columns={[
            { id: "part", label: "Part" },
            { id: "on-hand", label: "Our on hand" },
            { id: "reserved", label: "Reserved" },
            { id: "available", label: "Our available" },
          ]}
          renderItem={(item) => {
            const state = stockState(item);
            const stateText = stockStateLabel(state);
            const issue = stockIssuePill(item);
            const issueLabel = issue?.description || "";
            return <OperationalCollectionRow
            className="inventory-stock-row"
            key={stockItemKey(item)}
            aria-haspopup="dialog"
            ariaLabel={`Open details for ${item.partNumber}, ${issueLabel ? `${issueLabel}, ` : ""}${stateText}, ${quantity(item.quantityAvailable)} ${item.uomCode} available`}
            onAction={() => openListedPart(item)}
          >
            <OperationalCollectionCell className="inventory-part-cell" label="Part"><span className="inventory-part-heading"><strong className="inventory-part-number">{item.partNumber}</strong>{issue ? <SeverityPill {...issue} /> : null}</span><small>{item.description || "No part name"}</small></OperationalCollectionCell>
            <OperationalCollectionCell label="Usable on hand">{quantity(item.quantityOnHand)} {item.uomCode}</OperationalCollectionCell>
            <OperationalCollectionCell label="Reserved">{quantity(item.quantityReserved)} {item.uomCode}</OperationalCollectionCell>
            <OperationalCollectionCell className={`inventory-available-cell is-${state}`} label="Our available">
              {state === "out" ? <><strong>Out of stock</strong><small>{quantity(item.quantityOnHand)} {item.uomCode} on hand</small></>
                : state === "reserved" ? <><strong>{quantity(item.quantityAvailable)} {item.uomCode} available</strong><small>{quantity(item.quantityReserved)} {item.uomCode} reserved</small></>
                  : <><strong>{quantity(item.quantityAvailable)} {item.uomCode}</strong><small className="inventory-availability-meta"><span>{Number(item.locationCount || 0)} stocked location{Number(item.locationCount || 0) === 1 ? "" : "s"}</span>{item.lowStock ? <span className="inventory-availability-low">Low stock</span> : null}</small></>}
            </OperationalCollectionCell>
          </OperationalCollectionRow>}}
        >
          {query || locationId !== "all" || stockFilter !== "all" ? <div className="inventory-empty"><Package /><strong>No matching stock</strong><p>Change the filters or use Reset view above.</p></div> : <div className="inventory-empty"><Package /><strong>No local inventory yet</strong><p>Review an invoice and choose “Add to inventory.”</p></div>}
        </CheckpointCollection>
      </> : null}
      </> : <InventoryLocationStockWorkspace locations={browseLocations} initialShopId={stockLocationInitialShop} initialPositionId={stockLocationInitialPosition} refreshKey={refreshKey} canApplyInventoryCount={canApplyInventoryCount} onShopChange={setStockLocationInitialShop} onOpenPart={openLocationPart} onAddStock={({ part, locationParts, shopId, positionId, positionPath }) => setReceivingPart({ ...(part || {}), locationParts, receiptLocationId: shopId, receiptPositionId: positionId, receiptPositionPath: positionPath, lockReceiptLocation: true })} />}
      </> : null}
      </section>
      {inventorySection === "stock" ? <SecondaryDetailPanel
        open={Boolean(selectedItem)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !partIdentityBusy && !partIdentityDirty) closeSelectedPart();
        }}
        eyebrow={null}
        title={selectedItem?.partNumber || "Part"}
        description={selectedItem?.description || "No description"}
        status={selectedItem ? <span className="inventory-part-header-status"><span className="inventory-part-header-price">Selling · {partHeaderPrice.scopeKey === partHeaderPriceScopeKey ? partHeaderPrice.label || "—" : "…"} / {selectedItem.uomCode || "unit"}</span>{selectedLocationReadOnly ? <span className="inventory-view-only-badge">View only</span> : null}</span> : null}
        footer={null}
        dismissable={!partIdentityBusy && !partIdentityDirty}
        closeDisabled={partIdentityBusy || partIdentityDirty}
        closeLabel={partIdentityBusy ? "Saving part details" : partIdentityDirty ? "Reset changes before closing" : "Close part details"}
      >
        {selectedItem ? <>
          {partStockError ? <p className="ops-error" role="alert">{partStockError}</p> : null}
          {stockIssueLabel(selectedItem) ? <p className="inventory-part-issue-summary" role="status">{stockIssueLabel(selectedItem)}</p> : null}
          <div className="inventory-part-detail-navigation">
            <nav className="inventory-part-detail-pages" aria-label="Part detail pages">
              {[{ id: "stock", label: "Stock" }, { id: "activity", label: "Activity" }, { id: "details", label: "Details" }].map((page) => <button key={page.id} type="button" aria-current={partDetailPage === page.id ? "page" : undefined} disabled={partIdentityDirty && page.id !== "details"} onClick={() => { setPartDetailPage(page.id); setShelvingOpen(false); }}>{page.label}</button>)}
            </nav>
            {partDetailPage === "stock" && !selectedLocationReadOnly && ["quantity", "serialized", "measured_bulk"].includes(selectedItem.trackingMode) ? <Button className="inventory-part-detail-primary-action" type="button" variant="primary" onClick={() => setReceivingPart(selectedLocation ? { ...selectedItem, receiptLocationId: selectedLocation.locationId, receiptPositionId: selectedPositionContext?.positionId || "", receiptPositionPath: selectedPositionContext?.positionPath || selectedLocation.locationName, lockReceiptLocation: true } : selectedItem)}>Add stock</Button> : null}
          </div>

          {partDetailPage === "stock" ? selectedLocation && shelvingOpen ? <>
            <div className="inventory-part-detail-toolbar"><IconButton icon={ArrowLeft} label="Back to location" onClick={() => setShelvingOpen(false)} /></div>
            <PartPositionsPanel item={selectedItem} location={selectedLocation} initialSourcePositionId={selectedPositionContext?.positionId || ""} onChanged={() => setRefreshKey((value) => value + 1)} />
          </> : selectedLocation ? <>
            <div className="inventory-part-detail-toolbar">
              <div className="inventory-part-detail-toolbar-context"><IconButton icon={ArrowLeft} label="Back to all locations" onClick={() => setSelectedLocationId("")} /><div><span className="inventory-detail-location-name"><h3>{selectedLocation.locationName}</h3>{selectedLocationReadOnly ? <span className="inventory-view-only-badge">View only</span> : null}</span><p>{selectedPositionContext?.positionPath || (selectedLocationReadOnly ? "Company inventory · no changes allowed" : "")}</p></div></div>
              {!selectedLocationReadOnly && selectedItem.trackingMode !== "no_stock" ? <PartLocationSettings part={selectedItem} location={selectedLocation} onOpenShelves={() => setShelvingOpen(true)} onDamage={(sourceLocationId) => openStockDamage(selectedItem, sourceLocationId)} onTransfer={(sourceLocationId) => openStockTransfer(selectedItem, sourceLocationId)} onSaved={() => setRefreshKey((value) => value + 1)} /> : null}
            </div>
            {selectedItem.trackingMode === "no_stock" ? <div className="inventory-part-location-summary">
              <section className="inventory-part-location-balance" aria-label="No stock tracking"><p>No stock tracking</p></section>
              <PartCommercialDetails key={`${selectedItem.catalogPartId}:${selectedLocation.locationId}`} part={selectedItem} location={selectedLocation} readOnly={selectedLocationReadOnly} manageableLocationIds={manageableLocationIds} onChanged={() => setRefreshKey((value) => value + 1)} />
            </div> : selectedItem.trackingMode === "quantity" || selectedItem.trackingMode === "measured_bulk" ? <div className="inventory-part-location-summary">
              <section className="inventory-part-location-balance" aria-label={`${selectedLocation.locationName} stock balance`}>
                <div className="inventory-detail-metrics">
                  <div className="is-primary"><span>Available</span><strong>{quantity(selectedLocation.quantityAvailable)} {selectedItem.uomCode}</strong></div>
                  <div><span>On hand</span><strong>{quantity(selectedLocation.quantityOnHand)} {selectedItem.uomCode}</strong></div>
                  <div><span>Reserved</span><strong>{quantity(selectedLocation.quantityReserved)} {selectedItem.uomCode}</strong></div>
                </div>
              </section>
              <PartCommercialDetails key={`${selectedItem.catalogPartId}:${selectedLocation.locationId}`} part={selectedItem} location={selectedLocation} readOnly={selectedLocationReadOnly} manageableLocationIds={manageableLocationIds} onChanged={() => setRefreshKey((value) => value + 1)} />
            </div> : <>
              <PartSerializationPanel
                item={selectedItem}
                location={selectedLocation}
                companyId={selectedItem.companyId}
                actorId={actorId}
                onInventoryChanged={() => setRefreshKey((value) => value + 1)}
                onMarkDamaged={selectedLocationReadOnly ? undefined : (unit) => openStockDamage(selectedItem, selectedLocation.locationId, unit.serialNumber)}
                showAddAction={false}
                readOnly={selectedLocationReadOnly}
              />
              <PartCommercialDetails key={`${selectedItem.catalogPartId}:${selectedLocation.locationId}`} part={selectedItem} location={selectedLocation} readOnly={selectedLocationReadOnly} manageableLocationIds={manageableLocationIds} onChanged={() => setRefreshKey((value) => value + 1)} />
            </>}
          </> : <>
            {selectedItem.trackingMode === "no_stock" ? <section className="inventory-part-stock-overview" aria-label="No stock tracking">
              <p>No stock tracking</p>
            </section> : <section className="inventory-part-stock-overview" aria-label="Inventory summary">
              {!selectedItem.trackingMode ? <p>Review tracking in Details before adding stock.</p> : null}
              <div className="inventory-detail-metrics">
                <div className="is-primary"><span>Available</span><strong>{quantity(selectedItem.quantityAvailable)} {selectedItem.uomCode}</strong></div>
                <div><span>On hand</span><strong>{quantity(selectedItem.quantityOnHand)} {selectedItem.uomCode}</strong></div>
                <div><span>Reserved</span><strong>{quantity(selectedItem.quantityReserved)} {selectedItem.uomCode}</strong></div>
              </div>
              {Number(selectedItem.odooQuantityOnHand || 0) > 0 ? <p className="inventory-detail-provider-stock">Odoo · read-only · {quantity(selectedItem.odooQuantityOnHand)} {selectedItem.uomCode}</p> : null}
            </section>}
            {selectedItem.trackingMode === "no_stock" && noStockLocations.length ? <details className="inventory-no-stock-locations">
              <summary>Location prices</summary>
              <div className="inventory-detail-locations">{noStockLocations.map((location) => <div className="inventory-detail-location-row" key={location.id}><button type="button" onClick={() => setSelectedLocationId(location.id)}><span className="inventory-detail-location-name"><span>{location.name}</span>{location.canManage === false ? <span className="inventory-view-only-badge">View only</span> : null}</span></button></div>)}</div>
            </details> : null}
            {selectedItem.trackingMode !== "no_stock" ? <SecondaryDetailSection title="Locations">
              {stockedLocations.length ? <div className="inventory-detail-locations">{stockedLocations.map(partLocationRow)}</div> : <p className="inventory-detail-empty">No stock at any location.</p>}
              {otherLocations.length ? <details className="inventory-detail-other-locations"><summary>Other locations <span>{otherLocations.length}</span></summary><div className="inventory-detail-locations">{otherLocations.map(partLocationRow)}</div></details> : null}
            </SecondaryDetailSection> : null}
            <PartCommercialDetails key={`${selectedItem.catalogPartId}:company-defaults`} part={selectedItem} readOnly={!selectedCompanyCanManage} manageableLocationIds={manageableLocationIds} onChanged={() => setRefreshKey((value) => value + 1)} />
          </> : null}

          {partDetailPage === "activity" ? <section className="inventory-stock-activity-page" aria-labelledby="inventory-audit-log-heading">
            <header className="inventory-audit-log-heading"><div><h3 id="inventory-audit-log-heading">Activity</h3><p>{selectedLocation ? `${selectedLocation.locationName} · Filtered to this shop` : "All locations · Company-wide history"}</p></div>{selectedLocation ? <Button type="button" onClick={() => setSelectedLocationId("")}>Show all locations</Button> : null}</header>
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
              readOnly={!selectedCompanyCanManage || selectedLocationReadOnly}
            />
          </section> : null}
        </> : null}
      </SecondaryDetailPanel> : null}
      </>}
      {receivingPart ? <AddInventoryStockDialog part={receivingPart} locationParts={receivingPart.locationParts || []} actorId={actorId} locations={locations.filter((location) => !receivingPart.companyId || !location.companyId || location.companyId === receivingPart.companyId)} initialLocationId={receivingPart.receiptLocationId || (locationId !== "all" && locationId !== "master" ? locationId : "")} initialPositionId={receivingPart.receiptPositionId || ""} lockLocation={Boolean(receivingPart.lockReceiptLocation)} locationContextLabel={receivingPart.receiptPositionPath || ""} onClose={() => setReceivingPart(null)} onReceived={() => setRefreshKey((value) => value + 1)} /> : null}
    </OperationalCollectionPage>
  );
}
