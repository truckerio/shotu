import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  MarkerPin01,
  Pencil01,
  RefreshCw01,
} from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { Checkbox } from "../../components/ui/Checkbox.jsx";
import { IconButton } from "../../components/ui/IconButton.jsx";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { api } from "../../lib/api.js";
import {
  canContainSublocations,
  defaultSublocationType,
  INVENTORY_LOCATION_TYPES,
  locationChildren,
  locationId,
  locationName,
  locationPath,
  locationPathLabel,
  positionStorageDefaults,
  sublocationTypeOptions,
  visibleLocationTree,
} from "./inventory-location-model.js";
import "./inventory-locations-workspace.css";

const POSITION_USAGES = [
  ["", "No special use"],
  ["unassigned", "Unassigned"],
  ["receiving", "Receiving"],
  ["storage", "Storage"],
  ["quarantine", "Quarantine"],
  ["returns", "Returns"],
  ["repair_staging", "Repair staging"],
  ["dispatch", "Dispatch"],
];
function responseLocations(result) {
  return result?.positions || result?.items || [];
}
function positionDraft(position = {}, defaultKind = "warehouse") {
  const defaults = positionStorageDefaults(defaultKind);
  return {
    code: position.code || "",
    name: position.name || "",
    kind: position.kind || defaultKind,
    usage: position.usage || defaults.usage,
    canStore: position.id ? position.canStore === true : defaults.canStore,
    isPickable: position.id ? position.isPickable === true : defaults.isPickable,
  };
}

export function InventoryLocationsWorkspace({
  locations = [],
  initialLocationId = "",
  onChanged,
  showHeader = true,
}) {
  const [loadedLocations, setLoadedLocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [shopId, setShopId] = useState(
    initialLocationId,
  );
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const [expandedPositionIds, setExpandedPositionIds] = useState(() => new Set());
  const [editor, setEditor] = useState(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const shopLocations = locations;
  const activeLocationId = shopId;
  const tree = useMemo(
    () =>
      visibleLocationTree(loadedLocations, expandedPositionIds, query),
    [expandedPositionIds, loadedLocations, query],
  );
  const selected =
    loadedLocations.find((entry) => locationId(entry) === selectedPositionId) ||
    null;
  const editorParent = editor?.parentId
    ? loadedLocations.find((entry) => locationId(entry) === editor.parentId) || null
    : null;
  const editorKindOptions = editor?.mode === "create"
    ? sublocationTypeOptions(editorParent?.kind)
    : INVENTORY_LOCATION_TYPES;
  const selectedChildren = selected
    ? locationChildren(loadedLocations, locationId(selected)).sort((a, b) =>
        locationName(a).localeCompare(locationName(b)),
      )
    : [];
  const load = useCallback(async () => {
    if (!activeLocationId) return;
    setLoading(true);
    setError("");
    try {
      setLoadedLocations(
        responseLocations(
          await api(
            `/api/office/inventory/locations/${encodeURIComponent(activeLocationId)}/positions`,
          ),
        ),
      );
    } catch (next) {
      setError(next.message || "Locations could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [activeLocationId]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (initialLocationId) setShopId(initialLocationId);
  }, [initialLocationId]);
  useEffect(() => {
    if (!selected) return;
    const ancestorIds = locationPath(selected, loadedLocations)
      .slice(0, -1)
      .map(locationId);
    if (!ancestorIds.length) return;
    setExpandedPositionIds((current) => {
      if (ancestorIds.every((id) => current.has(id))) return current;
      return new Set([...current, ...ancestorIds]);
    });
  }, [loadedLocations, selected]);
  function openShop(nextShopId) {
    setSelectedPositionId("");
    setEditor(null);
    setLoadedLocations([]);
    setExpandedPositionIds(new Set());
    setQuery("");
    setError("");
    setShopId(nextShopId);
  }
  function closeShop() {
    const returnShopId = activeLocationId;
    setShopId("");
    setSelectedPositionId("");
    setEditor(null);
    setLoadedLocations([]);
    setExpandedPositionIds(new Set());
    setQuery("");
    setError("");
    window.requestAnimationFrame(() => document.getElementById(`inventory-shop-${returnShopId}`)?.focus({ preventScroll: true }));
  }
  function closePositionDetail() {
    const returnPositionId = selectedPositionId;
    setEditor(null);
    setSelectedPositionId("");
    window.requestAnimationFrame(() => document.getElementById(`inventory-position-${returnPositionId}`)?.focus({ preventScroll: true }));
  }
  function beginCreate(parent = selected) {
    const kind = defaultSublocationType(parent?.kind);
    if (parent && !kind) return;
    if (parent) {
      const parentId = locationId(parent);
      setExpandedPositionIds((current) => new Set([...current, parentId]));
    }
    setEditor({
      mode: "create",
      parentId: parent ? locationId(parent) : null,
      draft: positionDraft({}, kind || "warehouse"),
      idempotencyKey: crypto.randomUUID(),
    });
  }
  function beginEdit(location) {
    setEditor({
      mode: "edit",
      id: locationId(location),
      parentId: location.parentId || null,
      version: location.version,
      draft: positionDraft(location),
    });
  }
  async function submit(event) {
    event.preventDefault();
    if (!editor?.draft.name.trim() || !editor.draft.code.trim()) return;
    setError("");
    setBusy(true);
    try {
      const path =
        editor.mode === "create"
          ? `/api/office/inventory/locations/${encodeURIComponent(activeLocationId)}/positions`
          : `/api/office/inventory/positions/${encodeURIComponent(editor.id)}`;
      const body =
        editor.mode === "create"
          ? {
              parentId: editor.parentId,
              ...editor.draft,
              usage: editor.draft.usage || null,
              idempotencyKey: editor.idempotencyKey,
            }
          : { expectedVersion: editor.version, name: editor.draft.name.trim() };
      const saved = await api(path, {
        method: editor.mode === "create" ? "POST" : "PATCH",
        body: JSON.stringify(body),
      });
      setEditor(null);
      const savedPositionId = locationId(saved?.position);
      if (savedPositionId) setSelectedPositionId(savedPositionId);
      await load();
      onChanged?.();
    } catch (next) {
      setError(next.message || "Location could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  function togglePosition(positionId) {
    setExpandedPositionIds((current) => {
      const next = new Set(current);
      if (next.has(positionId)) next.delete(positionId);
      else next.add(positionId);
      return next;
    });
  }
  async function archive() {
    if (!selected) return;
    setError("");
    setBusy(true);
    try {
      await api(
        `/api/office/inventory/positions/${encodeURIComponent(locationId(selected))}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            isActive: false,
            expectedVersion: selected.version,
          }),
        },
      );
      setSelectedPositionId("");
      await load();
      onChanged?.();
    } catch (next) {
      setError(next.message || "Location could not be archived.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="inventory-locations-workspace"
      aria-labelledby={showHeader ? "inventory-locations-title" : undefined}
      aria-label={showHeader ? undefined : "Storage layout"}
    >
      {showHeader ? <header>
        <div>
          <h2 id="inventory-locations-title">Storage layout</h2>
          <p>
            Build only the levels your shop uses. Groups organize space; only
            positions marked “can store” can receive parts.
          </p>
        </div>
      </header> : null}
      {!activeLocationId ? <div className="inventory-shop-list" aria-label="Locations">
        <div className="inventory-shop-list-head">Location</div>
        {shopLocations.length ? shopLocations.map((entry) => {
          const entryId = locationId(entry);
          return <button id={`inventory-shop-${entryId}`} type="button" key={entryId} onClick={() => openShop(entryId)}>
            <span className="inventory-shop-list-name">
              <span className="inventory-shop-list-icon"><MarkerPin01 /></span>
              <span><strong>{locationName(entry)}</strong><small>{entry.address || entry.type || "Shop"}</small></span>
            </span>
            <ChevronRight aria-hidden="true" />
          </button>;
        }) : <p>No locations available.</p>}
      </div> : <>
      <div className="inventory-location-shop-context">
        <div className="inventory-location-shop-heading">
          <IconButton icon={ArrowLeft} label="Back to all locations" onClick={closeShop} />
          <strong>{locationName(shopLocations.find((entry) => locationId(entry) === activeLocationId))}</strong>
        </div>
        <Button type="button" icon={FolderPlus} variant="primary" onClick={() => beginCreate(null)} disabled={busy}>
          Add location
        </Button>
      </div>
      {error ? (
        <p className="ops-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className={`inventory-location-layout${editor || selected ? " has-detail" : ""}`}>
        <section
          className="inventory-location-tree"
          aria-label="Location hierarchy"
        >
          <label className="inventory-location-search">
            Search path
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Code, name, or path"
            />
          </label>
          {loading ? (
            <p role="status">
              <RefreshCw01 className="loading-icon" /> Loading locations…
            </p>
          ) : tree.length ? (
            <div className="inventory-location-tree-items" role="tree">
            {tree.map(({ location, depth, path, hasChildren, isExpanded, isMatch }) => (
              <div
                id={`inventory-position-${locationId(location)}`}
                key={locationId(location)}
                className={`inventory-location-tree-row${depth > 0 ? " is-child" : ""}${depth > 1 ? " is-deep-child" : ""}${
                  locationId(location) === locationId(selected) ? " is-selected" : ""
                }`}
                style={{ "--location-depth": depth }}
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={locationId(location) === locationId(selected)}
                aria-expanded={hasChildren ? isExpanded : undefined}
              >
                {hasChildren ? <button
                  type="button"
                  className="inventory-location-tree-toggle"
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} ${locationName(location)}`}
                  onClick={() => togglePosition(locationId(location))}
                >
                  {isExpanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                </button> : <span className="inventory-location-tree-spacer" aria-hidden="true" />}
                <button
                  type="button"
                  className="inventory-location-tree-select"
                  onClick={() => setSelectedPositionId(locationId(location))}
                >
                  <span>
                    <strong>{location.code || locationName(location)}</strong>
                    <small>
                      {path} · {location.kind || "Position"}
                      {location.canStore ? " · Can store" : ""}
                    </small>
                  </span>
                  {isMatch ? <span className="inventory-location-match">Match</span> : <ChevronRight aria-hidden="true" />}
                </button>
              </div>
            ))}
            </div>
          ) : (
            <p>No positions yet.</p>
          )}
        </section>
        {editor || selected ? <section className="inventory-location-detail" aria-live="polite">
          <IconButton className="inventory-location-detail-back" icon={ArrowLeft} label="Back to location hierarchy" onClick={closePositionDetail} />
          {editor ? (
            <form onSubmit={submit}>
              <h3>
                {editor.mode === "create"
                  ? editor.parentId ? "Add sublocation" : "Add location"
                  : "Edit location"}
              </h3>
              <p>
                {editor.parentId
                  ? `Inside ${locationPathLabel(
                      loadedLocations.find(
                        (entry) => locationId(entry) === editor.parentId,
                      ),
                      loadedLocations,
                    )}`
                  : locationName(shopLocations.find((entry) => locationId(entry) === activeLocationId))}
              </p>
              <label>
                Code
                <input
                  value={editor.draft.code}
                  maxLength="80"
                  required
                  disabled={editor.mode === "edit"}
                  onChange={(event) =>
                    setEditor((value) => ({
                      ...value,
                      draft: { ...value.draft, code: event.target.value },
                    }))
                  }
                />
              </label>
              <label>
                Name
                <input
                  value={editor.draft.name}
                  maxLength="160"
                  required
                  onChange={(event) =>
                    setEditor((value) => ({
                      ...value,
                      draft: { ...value.draft, name: event.target.value },
                    }))
                  }
                />
              </label>
              {editor.mode === "create" ? (
                <>
                  <label>
                    Type
                    <Dropdown
                      value={editor.draft.kind}
                      aria-label={editor.parentId ? "Sublocation type" : "Location type"}
                      onChange={(event) =>
                        setEditor((value) => ({
                          ...value,
                          draft: {
                            ...value.draft,
                            kind: event.target.value,
                            ...positionStorageDefaults(event.target.value),
                          },
                        }))
                      }
                    >
                      {editorKindOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Dropdown>
                  </label>
                  <label>
                    Usage
                    <Dropdown
                      value={editor.draft.usage}
                      aria-label="Position usage"
                      onChange={(event) =>
                        setEditor((value) => ({
                          ...value,
                          draft: { ...value.draft, usage: event.target.value },
                        }))
                      }
                    >
                      {POSITION_USAGES.map(([value, label]) => (
                        <option key={value || "none"} value={value}>
                          {label}
                        </option>
                      ))}
                    </Dropdown>
                  </label>
                  <label className="inventory-location-checkbox">
                    <Checkbox
                      checked={editor.draft.canStore}
                      onChange={(event) =>
                        setEditor((value) => ({
                          ...value,
                          draft: {
                            ...value.draft,
                            canStore: event.target.checked,
                          },
                        }))
                      }
                    />{" "}
                    Can store stock
                  </label>
                  <label className="inventory-location-checkbox">
                    <Checkbox
                      checked={editor.draft.isPickable}
                      onChange={(event) =>
                        setEditor((value) => ({
                          ...value,
                          draft: {
                            ...value.draft,
                            isPickable: event.target.checked,
                          },
                        }))
                      }
                    />{" "}
                    Pickable
                  </label>
                </>
              ) : null}
              <footer>
                <Button
                  type="button"
                  onClick={() => setEditor(null)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={busy}>
                  {busy ? "Saving…" : "Save location"}
                </Button>
              </footer>
            </form>
          ) : selected ? (
            <>
              <h3>{locationName(selected)}</h3>
              <nav className="inventory-location-breadcrumb" aria-label="Location path">
                <ol>
                  {locationPath(selected, loadedLocations).map((entry) => <li key={locationId(entry)}>
                    <button type="button" onClick={() => setSelectedPositionId(locationId(entry))} aria-current={locationId(entry) === locationId(selected) ? "location" : undefined}>
                      {locationName(entry)}
                    </button>
                    {locationId(entry) === locationId(selected) ? null : <ChevronRight aria-hidden="true" />}
                  </li>)}
                </ol>
              </nav>
              <dl>
                <div>
                  <dt>Code</dt>
                  <dd>{selected.code || "Not set"}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{selected.kind || "Position"}</dd>
                </div>
                <div>
                  <dt>Stock</dt>
                  <dd>{selected.canStore ? "Can store" : "Grouping only"}</dd>
                </div>
              </dl>
              {selectedChildren.length ? <section className="inventory-location-children" aria-label="Sublocations">
                <h4>Sublocations</h4>
                {selectedChildren.map((child) => <button type="button" key={locationId(child)} onClick={() => setSelectedPositionId(locationId(child))}>
                  <span><strong>{locationName(child)}</strong><small>{child.kind || "Location"}</small></span>
                  <ChevronRight aria-hidden="true" />
                </button>)}
              </section> : null}
              <footer>
                {canContainSublocations(selected.kind) ? <Button
                  type="button"
                  icon={FolderPlus}
                  onClick={() => beginCreate(selected)}
                  disabled={busy}
                >
                  Add sublocation
                </Button> : null}
                <Button
                  type="button"
                  icon={Pencil01}
                  onClick={() => beginEdit(selected)}
                  disabled={busy}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={archive}
                  disabled={busy}
                >
                  Archive
                </Button>
              </footer>
            </>
          ) : null}
        </section> : null}
      </div>
      </>}
    </section>
  );
}
