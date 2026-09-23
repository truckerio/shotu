import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, MarkerPin01, RefreshCw01 } from "@untitledui/icons";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { IconButton } from "../../components/ui/IconButton.jsx";
import { api } from "../../lib/api.js";
import {
  locationId,
  locationName,
  locationPathLabel,
  compactPlacementPath,
  visibleLocationTree,
} from "./inventory-location-model.js";
import { PositionCountPanel } from "./PositionCountPanel.jsx";
import "./inventory-locations-workspace.css";

function responsePositions(result) {
  return result?.positions || result?.items || [];
}

function responseStock(result) {
  return result?.items || result?.stock || result?.parts || [];
}

function quantity(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(Number(value || 0));
}

function arrivalTarget(position, positionId) {
  if (!position || position.canStore !== true || position.isActive === false) return null;
  if (position.systemKey === "receiving") return { positionId: "" };
  if (position.systemKey != null || position.usage !== "storage" || position.isPickable !== true) return null;
  return { positionId };
}

export function InventoryLocationStockWorkspace({ locations = [], initialShopId = "", initialPositionId = "", refreshKey = 0, canApplyInventoryCount = false, onShopChange, onOpenPart, onAddStock, onOpenStartingInventory }) {
  const [shopId, setShopId] = useState(initialShopId);
  const [positions, setPositions] = useState([]);
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const [expandedPositionIds, setExpandedPositionIds] = useState(() => new Set());
  const [scope, setScope] = useState("subtree");
  const [stock, setStock] = useState([]);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [loadingStock, setLoadingStock] = useState(false);
  const [error, setError] = useState("");
  const [stockRefreshKey, setStockRefreshKey] = useState(0);
  const [openingPartId, setOpeningPartId] = useState("");
  const [countMode, setCountMode] = useState(false);
  const [initialPositionPending, setInitialPositionPending] = useState(Boolean(initialPositionId));
  const selected = positions.find((entry) => locationId(entry) === selectedPositionId) || null;
  const selectedHasChildren = Boolean(selected && positions.some((entry) => entry.isActive !== false && String(entry.parentId || "") === selectedPositionId));
  const selectedIsCountableLeaf = Boolean(selected?.canStore === true && !selectedHasChildren);
  const selectedArrivalTarget = arrivalTarget(selected, selectedPositionId);
  const tree = useMemo(
    () => visibleLocationTree(positions, expandedPositionIds),
    [expandedPositionIds, positions],
  );
  const loadPositions = useCallback(async () => {
    if (!shopId) return;
    setLoadingPositions(true);
    setError("");
    try {
      setPositions(responsePositions(await api(`/api/office/inventory/locations/${encodeURIComponent(shopId)}/positions`)));
    } catch (next) {
      setError(next.message || "Locations could not be loaded.");
    } finally {
      setLoadingPositions(false);
    }
  }, [shopId]);
  useEffect(() => { loadPositions(); }, [loadPositions]);
  useEffect(() => { if (initialShopId && initialShopId !== shopId) openShop(initialShopId); }, [initialShopId, shopId]);
  useEffect(() => { setInitialPositionPending(Boolean(initialPositionId)); }, [initialPositionId]);
  useEffect(() => {
    if (!initialPositionPending || !initialPositionId || !positions.length) return;
    const byId = new Map(positions.map((entry) => [locationId(entry), entry]));
    if (!byId.has(initialPositionId)) return;
    const ancestors = new Set();
    let current = byId.get(initialPositionId);
    while (current?.parentId && byId.has(current.parentId)) {
      ancestors.add(current.parentId);
      current = byId.get(current.parentId);
    }
    setExpandedPositionIds(ancestors);
    setSelectedPositionId(initialPositionId);
    setInitialPositionPending(false);
  }, [initialPositionId, initialPositionPending, positions]);
  useEffect(() => {
    if (!selectedPositionId) {
      setStock([]);
      return undefined;
    }
    let active = true;
    setLoadingStock(true);
    setError("");
    api(`/api/office/inventory/locations/${encodeURIComponent(shopId)}/positions/${encodeURIComponent(selectedPositionId)}/stock?scope=${scope}`)
      .then((result) => { if (active) setStock(responseStock(result)); })
      .catch((next) => { if (active) setError(next.message || "Stock could not be loaded."); })
      .finally(() => { if (active) setLoadingStock(false); });
    return () => { active = false; };
  }, [refreshKey, scope, selectedPositionId, shopId, stockRefreshKey]);
  function openShop(nextShopId) {
    setShopId(nextShopId);
    setPositions([]);
    setSelectedPositionId("");
    setExpandedPositionIds(new Set());
    setStock([]);
    setError("");
    setCountMode(false);
    onShopChange?.(nextShopId);
  }
  function closeShop() {
    const returnId = shopId;
    setShopId("");
    setPositions([]);
    setSelectedPositionId("");
    setStock([]);
    setError("");
    setCountMode(false);
    onShopChange?.("");
    window.requestAnimationFrame(() => document.getElementById(`inventory-stock-shop-${returnId}`)?.focus({ preventScroll: true }));
  }
  function selectPosition(id) {
    setCountMode(false);
    setSelectedPositionId(id);
    window.requestAnimationFrame(() => document.getElementById("inventory-location-stock-detail")?.focus({ preventScroll: true }));
  }
  async function openPart(item) {
    if (!onOpenPart || openingPartId) return;
    const id = item.catalogPartId || item.partId || item.id || item.partNumber;
    setOpeningPartId(id);
    setError("");
    try {
      await onOpenPart({
        item,
        shopId,
        positionId: selectedPositionId,
        positionPath: locationPathLabel(selected, positions),
        canStore: selected?.canStore === true,
      });
    } catch (next) {
      setError(next.message || "Part details could not be loaded.");
    } finally {
      setOpeningPartId("");
    }
  }
  function addStockHere(part = null) {
    if (!selected || !selectedArrivalTarget || !onAddStock) return;
    onAddStock({
      part,
      shopId,
      positionId: selectedArrivalTarget.positionId,
      positionPath: locationPathLabel(selected, positions),
    });
  }
  function togglePosition(id) {
    setExpandedPositionIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function focusTreePosition(id) {
    window.requestAnimationFrame(() => document.getElementById(`inventory-stock-position-button-${id}`)?.focus({ preventScroll: true }));
  }
  function handleTreeKey(event, entry, index) {
    const id = locationId(entry.location);
    const focusAt = (nextIndex) => {
      const next = tree[nextIndex];
      if (next) focusTreePosition(locationId(next.location));
    };
    if (event.key === "ArrowDown") { event.preventDefault(); focusAt(Math.min(index + 1, tree.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focusAt(Math.max(index - 1, 0)); }
    else if (event.key === "Home") { event.preventDefault(); focusAt(0); }
    else if (event.key === "End") { event.preventDefault(); focusAt(tree.length - 1); }
    else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (entry.hasChildren && !entry.isExpanded) togglePosition(id);
      else if (entry.hasChildren) focusAt(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (entry.hasChildren && entry.isExpanded) togglePosition(id);
      else if (entry.location.parentId) focusTreePosition(entry.location.parentId);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectPosition(id);
    }
  }
  if (!shopId) return <section className="inventory-location-stock-workspace" aria-label="Stock by location">
    <div className="inventory-shop-list" aria-label="Locations">
      <div className="inventory-shop-list-head">Choose a shop</div>
      {locations.length ? locations.map((entry) => {
        const id = locationId(entry);
        return <button id={`inventory-stock-shop-${id}`} type="button" key={id} onClick={() => openShop(id)}>
          <span className="inventory-shop-list-name"><span className="inventory-shop-list-icon"><MarkerPin01 /></span><span><strong>{locationName(entry)}</strong><small>{entry.address || entry.type || "Shop"}</small></span></span>
          <ChevronRight aria-hidden="true" />
        </button>;
      }) : <p>No locations available.</p>}
    </div>
  </section>;
  return <section className="inventory-location-stock-workspace" aria-label="Stock by location">
    <div className="inventory-location-shop-context">
      <div className="inventory-location-shop-heading"><IconButton icon={ArrowLeft} label="Back to all shops" onClick={closeShop} /><strong>{locationName(locations.find((entry) => locationId(entry) === shopId))}</strong></div>
    </div>
    {error ? <p className="ops-error" role="alert">{error}</p> : null}
    <div className={`inventory-location-layout inventory-location-stock-layout${selected ? " has-detail" : ""}`}>
      <section className="inventory-location-tree" aria-label="Location hierarchy">
        {loadingPositions ? <p role="status"><RefreshCw01 className="loading-icon" /> Loading locations…</p> : tree.length ? <div className="inventory-location-tree-items" role="tree">
          {tree.map((entry, index) => { const { location, depth, path, hasChildren, isExpanded } = entry; return <div id={`inventory-stock-position-${locationId(location)}`} key={locationId(location)} className={`inventory-location-tree-row${depth > 0 ? " is-child" : ""}${depth > 1 ? " is-deep-child" : ""}${locationId(location) === selectedPositionId ? " is-selected" : ""}`} style={{ "--location-depth": depth }} role="treeitem" aria-level={depth + 1} aria-selected={locationId(location) === selectedPositionId} aria-expanded={hasChildren ? isExpanded : undefined}>
            {hasChildren ? <button type="button" className="inventory-location-tree-toggle" aria-label={`${isExpanded ? "Collapse" : "Expand"} ${locationName(location)}`} onClick={() => togglePosition(locationId(location))}>{isExpanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</button> : <span className="inventory-location-tree-spacer" aria-hidden="true" />}
            <button id={`inventory-stock-position-button-${locationId(location)}`} type="button" className="inventory-location-tree-select" tabIndex={locationId(location) === selectedPositionId || (!selectedPositionId && index === 0) ? 0 : -1} onKeyDown={(event) => handleTreeKey(event, entry, index)} onClick={() => selectPosition(locationId(location))}><span><strong>{location.code || locationName(location)}</strong><small>{path} · {location.kind || "Location"}</small></span><ChevronRight aria-hidden="true" /></button>
          </div>; })}
        </div> : <p>No storage locations yet.</p>}
      </section>
      {selected ? <section className={`inventory-location-detail inventory-location-stock-detail${countMode ? " is-counting" : ""}`} id="inventory-location-stock-detail" tabIndex="-1" aria-live="polite">
        <IconButton className="inventory-location-detail-back" icon={ArrowLeft} label="Back to location hierarchy" onClick={() => { setCountMode(false); setSelectedPositionId(""); }} />
        <header><div><h3>{locationName(selected)}</h3><p>{locationPathLabel(selected, positions)}</p></div>{countMode ? <span className="inventory-location-count-scope">Counting this exact location</span> : <div className="inventory-location-detail-actions">{selectedArrivalTarget ? <Button type="button" variant="primary" onClick={() => addStockHere()}>Add stock here</Button> : null}<label>Include <Dropdown value={scope} onChange={(event) => setScope(event.target.value)} aria-label="Stock scope"><option value="subtree">This location and sublocations</option><option value="direct">This location only</option></Dropdown></label></div>}</header>
        {!countMode && (loadingStock ? <p role="status"><RefreshCw01 className="loading-icon" /> Loading stock…</p> : stock.length ? <div className="inventory-location-stock-list">
          {stock.map((item) => { const id = item.catalogPartId || item.partId || item.id || item.partNumber; const placements=item.placements||[]; return <button type="button" key={id} onClick={() => openPart(item)} disabled={!onOpenPart || Boolean(openingPartId)} aria-label={`Open details for ${item.partNumber || item.code || "part"} at ${locationName(selected)}`}><span><strong>{item.partNumber || item.code || "Part"}</strong><small>{item.description || item.name || "No description"}</small>{placements.length ? <span className="inventory-location-stock-placements">{placements.map((placement)=><small key={placement.positionId}><b>{compactPlacementPath(placement,scope === "subtree" && placement.depth > 0)}</b><span>{placement.name && placement.name !== placement.code ? `${placement.name} · ` : ""}{quantity(placement.quantity)} {item.uomCode || ""}</span></small>)}</span>:null}</span><span>{openingPartId === id ? "Opening…" : `${quantity(scope === "subtree" ? item.subtreeQuantity : item.directQuantity)} ${item.uomCode || ""}`}</span><ChevronRight aria-hidden="true" /></button>; })}
        </div> : <div className="inventory-location-stock-empty"><strong>No stock in this scope</strong><p>{selectedArrivalTarget ? "Receive new goods here or start a physical count to certify what is present." : selected.canStore ? "Start a physical count to certify what is present in this location." : "Choose a broader scope or select a stock-holding location."}</p>{selectedArrivalTarget ? <Button type="button" variant="primary" onClick={() => addStockHere()}>Add stock here</Button> : null}</div>)}
        {selectedIsCountableLeaf ? <PositionCountPanel key={`${shopId}:${selectedPositionId}`} location={{ id: shopId }} position={selected} initialOpen={Boolean(initialPositionId && initialPositionId === selectedPositionId)} canApplyInventoryCount={canApplyInventoryCount} onModeChange={setCountMode} onAddStock={(part) => addStockHere(part)} onOpenStartingInventory={() => onOpenStartingInventory?.(shopId)} onChanged={() => setStockRefreshKey((value) => value + 1)} /> : null}
      </section> : null}
    </div>
  </section>;
}
