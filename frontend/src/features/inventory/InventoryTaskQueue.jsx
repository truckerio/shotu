import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button.jsx";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { OperationalDataCell, OperationalDataRow, OperationalDataTable } from "../../components/ui/OperationalDataTable.jsx";
import { SecondaryDetailPanel, SecondaryDetailSection } from "../../components/ui/SecondaryDetailPanel.jsx";
import { OperationalCollectionTabs, OperationalCollectionToolbar } from "../../components/operations/OperationalCollectionPage.jsx";
import { api } from "../../lib/api.js";
import { isPlainPrimaryActivation } from "../../components/ui/context-navigation.js";
import {
  INVENTORY_TASK_SOURCES,
  INVENTORY_TASK_VIEWS,
  inventoryTaskDetailUrl,
  inventoryTaskQueueUrl,
  isRecoverableTaskError,
  recoveredTaskFeedback,
  taskAgeLabel,
  taskAssignmentBody,
  taskOwnerLabel,
  taskSelectionFromSearch,
  taskSelectionUrl,
} from "./inventory-task-queue-model.js";
import "./inventory-task-queue.css";

const columns = [
  { id: "source", label: "Source", isRowHeader: true },
  { id: "age", label: "Age" },
  { id: "shop", label: "Shop" },
  { id: "owner", label: "Owner" },
  { id: "next", label: "Next" },
];

const commandKeys = new Map();
function commandIdentity(task, action) {
  return `inventory-task-assignment:${action}:${task.sourceType}:${task.sourceId}:${task.sourceVersion}:${task.assignmentVersion}`;
}
function commandKey(task, action) {
  const identity = commandIdentity(task, action);
  if (commandKeys.has(identity)) return commandKeys.get(identity);
  try {
    const stored = window.sessionStorage.getItem(identity);
    if (stored) { commandKeys.set(identity, stored); return stored; }
  } catch { /* in-memory retry identity remains available */ }
  const key = crypto.randomUUID();
  commandKeys.set(identity, key);
  try { window.sessionStorage.setItem(identity, key); } catch { /* in-memory fallback */ }
  return key;
}
function clearCommandKey(task, action) {
  const identity = commandIdentity(task, action);
  commandKeys.delete(identity);
  try { window.sessionStorage.removeItem(identity); } catch { /* in-memory key already cleared */ }
}

export function InventoryTaskQueue({ locations = [], onOpenTask }) {
  const initialSelection = useMemo(() => taskSelectionFromSearch(new URLSearchParams(window.location.search)), []);
  const [view, setView] = useState("my_work");
  const [locationId, setLocationId] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], page: 1, pageSize: 25, hasMore: false, capabilities: {} });
  const [selected, setSelected] = useState(null);
  const [detailLocator, setDetailLocator] = useState(initialSelection);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(Boolean(initialSelection));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const returnFocusId = useRef("");

  useEffect(() => { setPage(1); }, [view, locationId, sourceType, search]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    const timer = window.setTimeout(() => {
      api(inventoryTaskQueueUrl({ view, locationId, sourceType, search, page }))
        .then((result) => {
          if (!active) return;
          setData({ items: result.items || [], page: result.page || page, pageSize: result.pageSize || 25, hasMore: Boolean(result.hasMore), capabilities: result.capabilities || {} });
          setSelected((current) => current ? result.items?.find((item) => item.id === current.id) || current : null);
        })
        .catch((next) => { if (active) setError(next.message || "Inventory work could not be loaded."); })
        .finally(() => { if (active) setLoading(false); });
    }, search.trim() ? 180 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [locationId, page, refreshKey, search, sourceType, view]);

  const loadDetail = useCallback(async (locator, { recovery = false } = {}) => {
    if (!locator) return null;
    setDetailLoading(true);
    try {
      const result = await api(inventoryTaskDetailUrl(locator));
      setSelected(result.item);
      setDetailLocator(result.item);
      if (recovery) {
        const feedback = recoveredTaskFeedback();
        setError(feedback.error);
        setNotice(feedback.notice);
      }
      return result.item;
    } catch (next) {
      setError(next.message || "This inventory task could not be loaded.");
      if (next?.code === "inventory_not_found") closeDetail();
      return null;
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { if (initialSelection) loadDetail(initialSelection); }, [initialSelection, loadDetail]);

  function openDetail(task) {
    returnFocusId.current = `inventory-task-${task.id}`;
    setSelected(task); setDetailLocator(task); setNotice(""); setError("");
    window.history.replaceState({}, "", taskSelectionUrl(task));
  }
  function closeDetail() {
    setSelected(null); setDetailLocator(null); setNotice("");
    window.history.replaceState({}, "", taskSelectionUrl());
    const focusId = returnFocusId.current;
    if (focusId) window.requestAnimationFrame(() => document.getElementById(focusId)?.focus({ preventScroll: true }));
  }

  async function assign(action) {
    if (!selected || busy) return;
    setBusy(true); setError(""); setNotice("");
    const key = commandKey(selected, action);
    try {
      const result = await api("/api/office/inventory/task-queue/assignments", { method: "POST", body: JSON.stringify(taskAssignmentBody(selected, action, key)) });
      clearCommandKey(selected, action);
      setSelected(result.task);
      setDetailLocator(result.task);
      setData((current) => ({ ...current, items: current.items.map((item) => item.id === result.task.id ? result.task : item) }));
      setNotice(action === "claim" ? "Task added to My work." : "Task returned to the available team.");
      setRefreshKey((value) => value + 1);
    } catch (next) {
      setError(next.message || "Task ownership could not be updated.");
      if (isRecoverableTaskError(next)) await loadDetail(selected, { recovery: true });
    } finally { setBusy(false); }
  }

  const openLabel = selected?.nextAction ? `Open · ${selected.nextAction}` : "Open task";
  return <section className="inventory-task-queue" aria-label="Inventory tasks">
    <OperationalCollectionTabs ariaLabel="Inventory task views" activeId={view} onChange={setView} items={INVENTORY_TASK_VIEWS} />
    <OperationalCollectionToolbar className="inventory-task-toolbar">
      <label><span>Shop</span><Dropdown aria-label="Inventory task shop" value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">All shops</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</Dropdown></label>
      <label><span>Task type</span><Dropdown aria-label="Inventory task type" value={sourceType} onChange={(event) => setSourceType(event.target.value)}>{INVENTORY_TASK_SOURCES.map((source) => <option key={source.id || "all"} value={source.id}>{source.label}</option>)}</Dropdown></label>
      <label className="inventory-task-search"><span>Search</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search inventory tasks" placeholder="Part, invoice, PO, location" /></label>
      <Button type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>Refresh</Button>
    </OperationalCollectionToolbar>

    {error ? <div className="inventory-task-error" role="alert"><span>{error}</span><Button type="button" onClick={() => { setError(""); setRefreshKey((value) => value + 1); }}>Retry</Button></div> : null}
    {loading ? <div className="inventory-task-state" role="status"><strong>Loading My work…</strong></div> : null}
    {!loading && !error && !data.items.length ? <div className="inventory-task-state"><strong>{view === "my_work" ? "No inventory work needs you right now." : "No inventory tasks match these filters."}</strong><span>Refresh when new stock activity is ready.</span></div> : null}
    {!loading && data.items.length ? <OperationalDataTable ariaLabel="Inventory task queue" columns={columns} className="inventory-task-table inventory-data-table">{data.items.map((item) => <OperationalDataRow id={item.id} key={item.id} className={item.blocker ? "is-blocked" : ""}>
      <OperationalDataCell label="Source"><button id={`inventory-task-${item.id}`} type="button" className="inventory-task-open" onClick={() => openDetail(item)}><strong>{item.sourceLabel}</strong><span>{item.statusLabel}</span>{item.blocker ? <small>Blocked · {item.blocker}</small> : null}</button></OperationalDataCell>
      <OperationalDataCell label="Age"><span>{taskAgeLabel(item.ageSeconds)}</span></OperationalDataCell>
      <OperationalDataCell label="Shop"><span>{item.shop?.name || item.location?.name || "Shop unavailable"}</span></OperationalDataCell>
      <OperationalDataCell label="Owner"><span>{taskOwnerLabel(item)}</span></OperationalDataCell>
      <OperationalDataCell label="Next"><button type="button" className="inventory-task-open is-next" onClick={() => openDetail(item)}><strong>{item.nextAction}</strong><small>{item.blocker ? "Review blocker" : "View task"}</small></button></OperationalDataCell>
    </OperationalDataRow>)}</OperationalDataTable> : null}
    {!loading && !error && (page > 1 || data.hasMore) ? <nav className="inventory-task-pages" aria-label="Inventory task pages"><Button type="button" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><span>Page {page}</span><Button type="button" disabled={!data.hasMore} onClick={() => setPage((value) => value + 1)}>Next</Button></nav> : null}

    <SecondaryDetailPanel open={Boolean(detailLocator)} onOpenChange={(open) => { if (!open) closeDetail(); }} eyebrow="Inventory task" title={selected?.sourceLabel || "Loading task"} description={selected ? `${selected.shop?.name || selected.location?.name} · ${taskAgeLabel(selected.ageSeconds)}` : ""}>
      {detailLoading && !selected ? <p role="status">Loading task details…</p> : selected ? <div className="inventory-task-detail">
        {notice ? <p className="inventory-task-notice" role="status">{notice}</p> : null}
        <SecondaryDetailSection title="Next action"><div className="inventory-task-next"><strong>{selected.nextAction}</strong><span className="inventory-task-status">{selected.statusLabel}</span>{selected.blocker ? <p role="status"><strong>Blocked:</strong> {selected.blocker}</p> : null}</div></SecondaryDetailSection>
        <SecondaryDetailSection title="Ownership"><dl className="inventory-task-facts"><div><dt>Owner</dt><dd>{taskOwnerLabel(selected)}</dd></div><div><dt>Shop</dt><dd>{selected.shop?.name || selected.location?.name}</dd></div></dl><div className="inventory-task-assignment-actions">{selected.actions?.canClaim ? <Button type="button" onClick={() => assign("claim")} disabled={busy}>Claim task</Button> : null}{selected.actions?.canUnassign ? <Button type="button" onClick={() => assign("unassign")} disabled={busy}>Return to team</Button> : null}</div></SecondaryDetailSection>
        <SecondaryDetailSection title="Evidence"><dl className="inventory-task-facts"><div><dt>Source</dt><dd>{selected.sourceLabel}</dd></div><div><dt>Created</dt><dd>{new Date(selected.createdAt).toLocaleString()}</dd></div>{selected.evidence?.assignmentUpdatedAt ? <div><dt>Ownership updated</dt><dd>{new Date(selected.evidence.assignmentUpdatedAt).toLocaleString()}</dd></div> : null}</dl></SecondaryDetailSection>
        <a className="button primary inventory-task-primary" href={selected.deepLink} onClick={(event) => { if (onOpenTask && isPlainPrimaryActivation(event)) { event.preventDefault(); onOpenTask(selected); } }}><span>{openLabel}</span></a>
      </div> : null}
    </SecondaryDetailPanel>
  </section>;
}
