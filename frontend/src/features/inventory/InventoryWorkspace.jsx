import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, FileCheck02, Package, RefreshCw01, SearchMd, UploadCloud02 } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { ContextBreadcrumbs } from "../../components/ui/ContextBreadcrumbs.jsx";
import { isPlainPrimaryActivation } from "../../components/ui/context-navigation.js";
import { Pagination } from "../../components/ui/Pagination.jsx";
import { SecondaryDetailPanel, SecondaryDetailSection } from "../../components/ui/SecondaryDetailPanel.jsx";
import {
  OperationalCollectionCell,
  OperationalCollectionPage,
  OperationalCollectionResultHeader,
  OperationalCollectionRow,
  OperationalCollectionTable,
  OperationalCollectionTabs,
  OperationalCollectionToolbar,
} from "../../components/operations/OperationalCollectionPage.jsx";
import { api } from "../../lib/api.js";
import { InvoiceExtractionWorkspace } from "../office/InvoiceExtractionWorkspace.jsx";
import { PartIdentityEditor } from "./PartIdentityEditor.jsx";
import { PartSerializationPanel } from "./PartSerializationPanel.jsx";
import {
  DEFAULT_STOCK_SORT,
  STOCK_FILTER_OPTIONS,
  stockState,
  stockStateLabel,
} from "./inventory-workspace-model.js";
import { hasRefreshedPartIdentityVersion } from "./part-identity-editor-model.js";
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

export function InventoryWorkspace({ canApplyInventoryCount = false, presentation = "page" }) {
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
  const [locations, setLocations] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stockLoaded, setStockLoaded] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedStockKey, setSelectedStockKey] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [partIdentityEditOpen, setPartIdentityEditOpen] = useState(false);
  const [partIdentityBusy, setPartIdentityBusy] = useState(false);
  const [partIdentityOverride, setPartIdentityOverride] = useState(null);
  const [partIdentityRefreshPending, setPartIdentityRefreshPending] = useState(null);
  const [stockPage, setStockPage] = useState(1);
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
    const item = items.find((entry) => stockItemKey(entry) === selectedStockKey) || null;
    return item && partIdentityOverride?.catalogPartId === item.catalogPartId ? { ...item, ...partIdentityOverride } : item;
  }, [items, partIdentityOverride, selectedStockKey]);
  const selectedLocation = selectedItem?.locations.find((location) => location.locationId === selectedLocationId) || null;

  useEffect(() => {
    setSelectedLocationId("");
    setPartIdentityEditOpen(false);
    setPartIdentityBusy(false);
    setPartIdentityOverride(null);
    setPartIdentityRefreshPending(null);
  }, [selectedStockKey]);

  useEffect(() => {
    if (!partIdentityRefreshPending) return;
    const refreshedItem = items.find((item) => item.catalogPartId === partIdentityRefreshPending.catalogPartId);
    if (!hasRefreshedPartIdentityVersion(refreshedItem, partIdentityRefreshPending)) return;
    setPartIdentityRefreshPending(null);
    window.requestAnimationFrame(() => document.getElementById("inventory-edit-part")?.focus({ preventScroll: true }));
  }, [items, partIdentityRefreshPending]);

  const onPartIdentityEditStateChange = useCallback((state) => {
    setPartIdentityBusy(Boolean(state?.busy));
  }, []);

  function closePartIdentityEditor() {
    setPartIdentityEditOpen(false);
    window.requestAnimationFrame(() => document.getElementById("inventory-edit-part")?.focus({ preventScroll: true }));
  }

  function handlePartIdentitySaved(part) {
    setPartIdentityOverride((current) => ({ ...(selectedItem || current || {}), ...(part || {}) }));
    setPartIdentityEditOpen(false);
    setRefreshKey((value) => value + 1);
    window.requestAnimationFrame(() => document.getElementById("inventory-edit-part")?.focus({ preventScroll: true }));
  }

  function reloadPartIdentity() {
    if (!selectedItem) return;
    setPartIdentityOverride(null);
    setPartIdentityEditOpen(false);
    setPartIdentityRefreshPending({ catalogPartId: selectedItem.catalogPartId, version: selectedItem.version });
    setRefreshKey((value) => value + 1);
  }

  function openPartIdentityEditor() {
    if (!partIdentityRefreshPending) setPartIdentityEditOpen(true);
  }

  function openInvoiceWorkflow(invoiceRun = "") {
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
    const returnFocusId = invoiceWorkflowOpen ? "inventory-invoice-action" : countWorkflowOpen ? "inventory-count-action" : "";
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

  const inventoryTitle = invoiceWorkflowOpen ? "Invoice intake" : countWorkflowOpen ? "Inventory files" : "Parts inventory";
  const inventorySubtitle = invoiceWorkflowOpen
    ? "Upload, review, and add parts without leaving inventory."
    : countWorkflowOpen
      ? "Review uploaded inventory files and their import status."
      : "Owned by this system and organized by shop.";
  const inventoryLeading = invoiceWorkflowOpen || countWorkflowOpen ? <ContextBreadcrumbs
    items={[
      {
        label: "Inventory",
        href: inventoryUrl().toString(),
        onClick: followInventoryBreadcrumb,
      },
      ...(workflowDetail ? [{
        label: invoiceWorkflowOpen ? "Invoice intake" : "Inventory files",
        href: inventoryUrl(invoiceWorkflowOpen ? { upload: true } : { count: true }).toString(),
        onClick: followWorkflowBreadcrumb,
      }] : []),
    ]}
    current={workflowDetail?.label || inventoryTitle}
  /> : null;
  const inventoryActions = countWorkflowOpen ? (
    <Button type="button" variant="primary" icon={UploadCloud02} onClick={() => setCountUploadOpen(true)}>Add inventory</Button>
  ) : invoiceWorkflowOpen ? (
    !workflowDetail ? <Button className="inventory-invoice-upload-button" type="button" icon={UploadCloud02} aria-label="Upload invoices" title="Upload invoices" aria-haspopup="dialog" onClick={() => setInvoiceUploadOpen(true)} /> : null
  ) : <>
    <Button className="inventory-refresh-button" type="button" icon={RefreshCw01} aria-label="Refresh inventory" title="Refresh inventory" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading} />
    <Button id="inventory-count-action" type="button" icon={FileCheck02} onClick={openCountWorkflow}>Count</Button>
    <Button id="inventory-invoice-action" type="button" variant="primary" icon={UploadCloud02} onClick={() => openInvoiceWorkflow()}>Invoice</Button>
  </>;

  return (
    <OperationalCollectionPage
      className={`${presentation === "page" ? "admin-content " : ""}inventory-workspace${invoiceWorkflowOpen || countWorkflowOpen ? " is-invoice-workflow" : ""}`}
      presentation={presentation}
      title={inventoryTitle}
      subtitle={inventorySubtitle}
      leading={inventoryLeading}
      actions={inventoryActions}
    >

      {invoiceWorkflowOpen ? <InvoiceExtractionWorkspace embedded availableLocations={locations} uploadOpen={invoiceUploadOpen} onUploadOpenChange={setInvoiceUploadOpen} onContextChange={updateWorkflowDetail} /> : countWorkflowOpen ? <Suspense fallback={<div className="inventory-empty"><Package /><strong>Loading inventory files</strong></div>}><InventoryCountImportPanel locations={locations} initialImportId={initialParams.get("countImport") || ""} uploadOpen={countUploadOpen} onUploadOpenChange={setCountUploadOpen} canApplyInventoryCount={canApplyInventoryCount} onApplied={() => setRefreshKey((value) => value + 1)} onContextChange={updateWorkflowDetail} /></Suspense> : <>

      <OperationalCollectionTabs
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
          className={`inventory-stock-table${refreshing ? " is-refreshing" : ""}`}
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
            onAction={() => setSelectedStockKey(stockItemKey(item))}
          >
            <OperationalCollectionCell className="inventory-part-cell" label="Part"><span><strong>{item.partNumber}</strong><span className={`inventory-stock-state is-${state}`}>{stateText}</span></span><small>{item.description || "No description"}</small></OperationalCollectionCell>
            <OperationalCollectionCell label="Our on hand">{quantity(item.quantityOnHand)} {item.uomCode}</OperationalCollectionCell>
            <OperationalCollectionCell label="Reserved">{quantity(item.quantityReserved)} {item.uomCode}</OperationalCollectionCell>
            <OperationalCollectionCell className="inventory-available-cell" label="Our available"><strong>{quantity(item.quantityAvailable)} {item.uomCode}</strong><small>{Number(item.locationCount || 0)} stocked location{Number(item.locationCount || 0) === 1 ? "" : "s"}</small></OperationalCollectionCell>
          </OperationalCollectionRow>})}
        </OperationalCollectionTable> : query || locationId !== "all" || stockFilter !== "all" ? <div className="inventory-empty"><Package /><strong>No matching stock</strong><p>Change the filters or use Reset view above.</p></div> : <div className="inventory-empty"><Package /><strong>No local inventory yet</strong><p>Review an invoice and choose “Add to inventory.”</p></div>}
        <Pagination currentPage={stockPage} pageCount={stockMeta.pageCount} setPage={setStockPage} total={stockMeta.total} label="parts" loading={refreshing} />
      </> : null}

      <SecondaryDetailPanel
        open={Boolean(selectedItem)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !partIdentityEditOpen && !partIdentityBusy) setSelectedStockKey("");
        }}
        eyebrow="Part details"
        title={selectedItem?.partNumber || "Part"}
        description={selectedItem?.description || "No description"}
        status={selectedItem ? <span className={`inventory-detail-status ${selectedItem.quantityAvailable > 0 ? "is-available" : "is-unavailable"}`}>{selectedItem.quantityAvailable > 0 ? "Our inventory available" : "Our inventory 0"}</span> : null}
        footer={!partIdentityEditOpen ? <Button type="button" onClick={() => setSelectedStockKey("")}>Close</Button> : null}
        dismissable={!partIdentityEditOpen}
        onClose={partIdentityEditOpen ? closePartIdentityEditor : null}
        closeDisabled={partIdentityBusy}
        closeLabel={partIdentityBusy ? "Saving part details" : partIdentityEditOpen ? "Discard part identity edits" : "Close part details"}
      >
        {selectedItem ? selectedLocation ? <PartSerializationPanel
          item={selectedItem}
          location={selectedLocation}
          onBack={() => setSelectedLocationId("")}
          onInventoryChanged={() => setRefreshKey((value) => value + 1)}
        /> : <>
          <SecondaryDetailSection title="Inventory">
            <div className="inventory-detail-metrics">
              <div><span>Our stock</span><strong>{quantity(selectedItem.quantityOnHand)} {selectedItem.uomCode}</strong></div>
              <div><span>Our reserved</span><strong>{quantity(selectedItem.quantityReserved)} {selectedItem.uomCode}</strong></div>
              <div><span>Odoo · read-only</span><strong>{quantity(selectedItem.odooQuantityOnHand)} {selectedItem.uomCode}</strong></div>
            </div>
          </SecondaryDetailSection>

          <SecondaryDetailSection title="Locations">
            <div className="inventory-detail-locations">
              {selectedItem.locations.map((location) => <button type="button" key={location.locationId} onClick={() => setSelectedLocationId(location.locationId)} disabled={partIdentityEditOpen}>
                <div><strong>{location.locationName}</strong><small><b>{quantity(location.quantityAvailable)} {selectedItem.uomCode}</b> available · {quantity(location.odooQuantityOnHand)} {selectedItem.uomCode} in Odoo</small></div>
                <ChevronRight aria-hidden="true" />
              </button>)}
            </div>
          </SecondaryDetailSection>

          <SecondaryDetailSection
            title="Part identity"
            description={partIdentityRefreshPending ? "Reloading current details before editing can resume." : ""}
            action={!partIdentityEditOpen ? <Button id="inventory-edit-part" type="button" onClick={openPartIdentityEditor} disabled={Boolean(partIdentityRefreshPending)}>{partIdentityRefreshPending ? "Refreshing details" : "Edit part"}</Button> : null}
          >
            {partIdentityEditOpen ? <PartIdentityEditor
              part={selectedItem}
              onCancel={closePartIdentityEditor}
              onEditStateChange={onPartIdentityEditStateChange}
              onReload={reloadPartIdentity}
              onSaved={handlePartIdentitySaved}
            /> : <dl className="inventory-detail-facts">
              <div><dt>Part name</dt><dd>{selectedItem.description || "Not set"}</dd></div>
              <div><dt>Primary part number</dt><dd>{selectedItem.partNumber || "Not set"}</dd></div>
              <div><dt>Manufacturer</dt><dd>{selectedItem.manufacturer || "Not set"}</dd></div>
              <div><dt>Category</dt><dd>{selectedItem.category || "Not set"}</dd></div>
              <div><dt>Catalog barcode</dt><dd>{selectedItem.barcode || "Not set"}</dd></div>
              <div><dt>Reference numbers</dt><dd>{selectedItem.referenceNumbers?.length ? selectedItem.referenceNumbers.join(", ") : "None"}</dd></div>
              <div><dt>Unit</dt><dd>{selectedItem.uomCode}</dd></div>
              {selectedItem.providerManaged ? <div><dt>Identity source</dt><dd>Managed in Odoo</dd></div> : null}
            </dl>}
          </SecondaryDetailSection>

        </> : null}
      </SecondaryDetailPanel>
      </>}
    </OperationalCollectionPage>
  );
}
