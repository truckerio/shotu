import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.js";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { OperationalCollectionTabs } from "../../components/operations/OperationalCollectionPage.jsx";
import { InspectionDetail } from "./InspectionDetail.jsx";
import { InspectionQueue } from "./InspectionQueue.jsx";
import { inspectionFromApi, inspectionRefreshMode, loadInspectionRefreshWindow, MAX_LIVE_INSPECTION_ROWS, mergeFastInspectionPage, responsePayload } from "./inspection-api-model.js";
import { renderAndPrintInspectionSlip } from "./inspection-print.js";
import { readInspectionSession, writeInspectionSession } from "./inspection-session-state.js";
import { productModuleCapabilities } from "../../app/routes/product-module-access.js";
import { createLatestRequestGuard, LIVE_QUEUE_REFRESH_INTERVAL_MS, useAutomaticRefresh } from "../../hooks/useAutomaticRefresh.js";
import "./inspections.css";

export function InspectionExperience({ actor, projection = "office", initialInspectionId = "", onBack, onCreateWorkorder, onAssign }) {
  const initialSession = readInspectionSession(projection);
  const fullProjection = projection === "office" || projection === "admin";
  const readOnly = projection === "read_only";
  const allowedInitialStatuses = fullProjection ? ["needs_action", "in_progress", "completed"] : ["completed"];
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState(initialSession.search);
  const [status, setStatus] = useState(allowedInitialStatuses.includes(initialSession.status) ? initialSession.status : (fullProjection ? "needs_action" : ""));
  const [active, setActive] = useState(null);
  const [mechanics, setMechanics] = useState([]);
  const [eligibleWorkorders, setEligibleWorkorders] = useState(null);
  const [nextCursor, setNextCursor] = useState("");
  const [state, setState] = useState({ loading: true, error: "" });
  const activeRef = useRef(null);
  const saveQueue = useRef(Promise.resolve());
  const workorderCreateKeys = useRef(new Map());
  const workorderCreateRequests = useRef(new Map());
  const queueScrollY = useRef(initialSession.scrollY);
  const loadGeneration = useRef(createLatestRequestGuard());
  const loadedItemCount = useRef(0);
  const foregroundLoads = useRef(0);
  const abortBackgroundLoad = useRef(null);
  const refreshCycle = useRef(0);

  const load = useCallback(async ({ cursor = "", append = false, background = "", signal } = {}) => {
    if (background && foregroundLoads.current > 0) return true;
    if (!background) {
      foregroundLoads.current += 1;
      abortBackgroundLoad.current?.();
    }
    const generation = loadGeneration.current.begin();
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener("abort", abortFromCaller, { once: true });
    if (signal?.aborted) controller.abort();
    if (background) abortBackgroundLoad.current = () => controller.abort();
    if (!background) setState((current) => ({ ...current, error: "" }));
    try {
      const fetchPage = ({ cursor: pageCursor = "", limit } = {}) => {
        const params = new URLSearchParams();
        if (["needs_action", "completed", "in_progress"].includes(status)) params.set("status", status);
        if (search.trim()) params.set("search", search.trim());
        if (pageCursor) params.set("cursor", pageCursor);
        if (limit) params.set("limit", String(limit));
        return api(`/api/inspections?${params}`, { signal: controller.signal });
      };
      const result = background === "reconcile"
        ? await loadInspectionRefreshWindow(fetchPage, { loadedCount: Math.max(loadedItemCount.current, 25) })
        : await fetchPage({ cursor });
      if (controller.signal.aborted || !loadGeneration.current.isCurrent(generation)) return background;
      const nextItems = (result.items || []).map(inspectionFromApi);
      if (background === "reconcile") {
        setItems(nextItems);
        loadedItemCount.current = nextItems.length;
        setNextCursor(result.nextCursor || "");
      } else if (background === "fast") {
        setItems((current) => {
          const updated = mergeFastInspectionPage(current, nextItems);
          loadedItemCount.current = updated.length;
          return updated;
        });
      } else {
        setItems((current) => {
          const updated = (append ? [...current, ...nextItems] : nextItems).slice(0, MAX_LIVE_INSPECTION_ROWS);
          loadedItemCount.current = updated.length;
          return updated;
        });
        setNextCursor(result.nextCursor || "");
      }
      setState({ loading: false, error: "" });
      return true;
    } catch (error) {
      if (loadGeneration.current.isCurrent(generation) && !background) setState({ loading: false, error: error.message });
      return background && controller.signal.aborted;
    } finally {
      signal?.removeEventListener("abort", abortFromCaller);
      if (background && abortBackgroundLoad.current) abortBackgroundLoad.current = null;
      if (!background) foregroundLoads.current = Math.max(0, foregroundLoads.current - 1);
    }
  }, [search, status]);

  useEffect(() => { const timer = window.setTimeout(() => load(), search ? 250 : 0); return () => window.clearTimeout(timer); }, [load, search]);
  useAutomaticRefresh(({ signal } = {}) => {
    refreshCycle.current += 1;
    return load({ background: inspectionRefreshMode(refreshCycle.current), signal });
  }, { enabled: !active, intervalMs: LIVE_QUEUE_REFRESH_INTERVAL_MS });
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { const id = initialInspectionId || initialSession.activeId; if (id) open({ id }); }, [initialInspectionId]);
  useEffect(() => () => writeInspectionSession(projection, { search, status, activeId: "", scrollY: queueScrollY.current }), [projection, search, status]);
  useEffect(() => { if (initialSession.scrollY) window.requestAnimationFrame(() => window.scrollTo({ top: initialSession.scrollY })); }, []);
  useEffect(() => {
    if (!fullProjection || !active?.locationId) return undefined;
    const controller = new AbortController();
    api(`/api/inspections/create-context?locationId=${encodeURIComponent(active.locationId)}`, { signal: controller.signal }).then((result) => setMechanics(result.mechanics || [])).catch(() => {});
    return () => controller.abort();
  }, [active?.locationId, fullProjection]);

  async function open(record) {
    setState((current) => ({ ...current, error: "" }));
    setEligibleWorkorders(null);
    queueScrollY.current = window.scrollY;
    writeInspectionSession(projection, { search, status, activeId: "", scrollY: queueScrollY.current });
    try {
      let result = await api(`/api/inspections/${encodeURIComponent(record.id)}`);
      const recordInspectionAccess = productModuleCapabilities(actor, "inspections", result.inspection.locationId);
      if (projection === "mechanic" && recordInspectionAccess.canWrite && result.inspection.status === "assigned") {
        result = await api(`/api/inspections/${encodeURIComponent(record.id)}/actions/start`, { method: "POST", body: JSON.stringify({ expectedVersion: result.inspection.version }) });
      }
      const next = inspectionFromApi(result.inspection);
      activeRef.current = next; setActive(next);
      const recordWorkorderAccess = productModuleCapabilities(actor, "workorders", result.inspection.locationId);
      if (recordInspectionAccess.canWrite && recordWorkorderAccess.canWrite && onCreateWorkorder) {
        api(`/api/inspections/${encodeURIComponent(record.id)}/workorders?limit=20`)
          .then((workorders) => setEligibleWorkorders(workorders.items || []))
          .catch((error) => {
            setEligibleWorkorders(false);
            setState((current) => ({ ...current, error: error.message }));
          });
      } else setEligibleWorkorders([]);
    } catch (error) { setState((current) => ({ ...current, error: error.message })); }
  }

  async function reloadActive() {
    const current = activeRef.current;
    if (!current) return null;
    const result = await api(`/api/inspections/${encodeURIComponent(current.id)}`);
    const next = inspectionFromApi(result.inspection);
    activeRef.current = next; setActive(next);
    return next;
  }

  function saveResponse({ itemKey, value }) {
    const request = saveQueue.current.catch(() => {}).then(async () => {
      const current = activeRef.current;
      if (!current) throw new Error("Inspection is no longer open.");
      try {
        const result = await api(`/api/inspections/${encodeURIComponent(current.id)}/responses`, {
          method: "PATCH",
          body: JSON.stringify({ expectedVersion: current.version, responses: [responsePayload(itemKey, value)] }),
        });
        const normalized = inspectionFromApi(result.inspection);
        const next = { ...current, ...normalized, responses: { ...current.responses, ...normalized.responses, [itemKey]: { ...value, ...normalized.responses?.[itemKey] } } };
        activeRef.current = next; setActive(next);
      } catch (error) {
        if (error?.status === 409) {
          await reloadActive().catch(() => {});
          const conflict = new Error("This inspection changed elsewhere. Review the latest version, then retry your response.");
          conflict.status = 409;
          throw conflict;
        }
        throw error;
      }
    });
    saveQueue.current = request.catch(() => {});
    return request;
  }

  async function complete({ result: derivedResult, finalNotes = "" }) {
    const current = activeRef.current;
    try {
      const result = await api(`/api/inspections/${encodeURIComponent(current.id)}/actions/complete`, { method: "POST", body: JSON.stringify({ expectedVersion: current.version, finalNotes }) });
      const refreshed = await api(`/api/inspections/${encodeURIComponent(current.id)}`);
      const next = inspectionFromApi({ ...refreshed.inspection, result: result.inspection.result || derivedResult });
      activeRef.current = next; setActive(next); await load();
    } catch (error) { setState((value) => ({ ...value, error: error.message })); }
  }

  async function print() {
    const popup = window.open("", "_blank");
    try {
      if (!popup) throw new Error("Allow pop-ups to print the inspection slip.");
      popup.opener = null;
      popup.document.write("<p>Preparing inspection slip…</p>");
      const current = activeRef.current;
      let result;
      if (productModuleCapabilities(actor, "inspections", current.locationId).canWrite) {
        const archived = await api(`/api/inspections/${encodeURIComponent(current.id)}/print-archives`, { method: "POST", body: JSON.stringify({ idempotencyKey: `inspection-print-${current.id}-v${current.version}` }) });
        result = await api(`/api/inspections/${encodeURIComponent(current.id)}/print-archives/${encodeURIComponent(archived.archive.id)}`);
      } else result = await api(`/api/inspections/${encodeURIComponent(current.id)}/print`);
      await renderAndPrintInspectionSlip(popup, result.html);
    } catch (error) { popup?.close(); setState((value) => ({ ...value, error: error.message })); }
  }

  function createWorkorder(responses) {
    const current = activeRef.current;
    if (!current) return Promise.resolve();
    const findings = Object.values(responses || {}).filter((response) => response.response === "issue" && response.disposition === "new_workorder" && response.findingId);
    const findingIds = findings.map((response) => response.findingId).sort();
    if (!findingIds.length) return Promise.resolve();
    const concern = findings.map((response) => response.note).filter(Boolean).join("; ");
    const officeNotes = `Created from inspection ${current.number || current.id}`;
    const requestIdentity = JSON.stringify([current.id, findingIds, concern, officeNotes]);
    if (workorderCreateRequests.current.has(requestIdentity)) return workorderCreateRequests.current.get(requestIdentity);
    if (!workorderCreateKeys.current.has(requestIdentity)) workorderCreateKeys.current.set(requestIdentity, `inspection-workorder-${crypto.randomUUID()}`);
    setState((value) => ({ ...value, error: "" }));
    const request = api(`/api/inspections/${encodeURIComponent(current.id)}/workorders`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion: current.version, findingIds, idempotencyKey: workorderCreateKeys.current.get(requestIdentity), concern, officeNotes }),
    }).then((result) => {
      const next = inspectionFromApi(result.inspection);
      activeRef.current = next;
      setActive(next);
      return result;
    }).catch((error) => {
      setState((value) => ({ ...value, error: error.message }));
      throw error;
    }).finally(() => {
      workorderCreateRequests.current.delete(requestIdentity);
    });
    workorderCreateRequests.current.set(requestIdentity, request);
    return request;
  }

  async function assign(mechanicId) {
    const current = activeRef.current;
    if (!current) throw new Error("Assignment is unavailable for this inspection.");
    const next = typeof onAssign === "function"
      ? await onAssign({ inspection: current, mechanicId })
      : await api(`/api/inspections/${encodeURIComponent(current.id)}/actions/assign`, { method: "POST", body: JSON.stringify({ expectedVersion: current.version, mechanicUserIds: [mechanicId] }) });
    if (next) { const normalized = inspectionFromApi(next.inspection || next); activeRef.current = normalized; setActive(normalized); }
  }

  async function linkWorkorder({ findingId, workorderId }) {
    const current = activeRef.current;
    setState((value) => ({ ...value, error: "" }));
    try {
      const result = await api(`/api/inspections/${encodeURIComponent(current.id)}/findings/${encodeURIComponent(findingId)}/workorder-links`, { method: "POST", body: JSON.stringify({ expectedVersion: current.version, workorderId, idempotencyKey: `inspection-link-${findingId}-${workorderId}` }) });
      const next = inspectionFromApi(result.inspection); activeRef.current = next; setActive(next);
    } catch (error) {
      setState((value) => ({ ...value, error: error.message }));
      throw error;
    }
  }

  const projectionFor = (inspection) => productModuleCapabilities(actor, "inspections", inspection.locationId).canWrite ? projection : "read_only";
  const activeInspectionAccess = productModuleCapabilities(actor, "inspections", active?.locationId);
  const activeWorkorderAccess = productModuleCapabilities(actor, "workorders", active?.locationId);
  const activeProjection = readOnly || !activeInspectionAccess.canWrite ? "read_only" : projection;

  function returnToQueue() {
    setActive(null);
    writeInspectionSession(projection, { search, status, activeId: "", scrollY: queueScrollY.current });
    load().finally(() => window.requestAnimationFrame(() => window.scrollTo({ top: queueScrollY.current })));
  }

  if (active) return <InspectionDetail inspection={active} projection={activeProjection} mechanics={mechanics} eligibleWorkorders={eligibleWorkorders} actionError={state.error} onAssign={fullProjection && activeInspectionAccess.canWrite ? assign : null} onLinkWorkorder={activeInspectionAccess.canWrite && activeWorkorderAccess.canWrite && onCreateWorkorder ? linkWorkorder : null} onBack={returnToQueue} onResponse={activeInspectionAccess.canWrite ? saveResponse : null} onReload={reloadActive} onComplete={activeInspectionAccess.canWrite ? complete : null} onCreateOrLinkWorkorder={activeInspectionAccess.canWrite && activeWorkorderAccess.canWrite && onCreateWorkorder ? createWorkorder : null} onPrint={active.status === "completed" ? print : null} />;
  return <section className="inspection-experience" aria-label="Inspection workspace">
    {onBack ? <button className="inspection-back" type="button" onClick={onBack}>Back</button> : null}
    {fullProjection ? <OperationalCollectionTabs className="inspection-lifecycle-tabs" ariaLabel="Inspection status" activeId={status} onChange={setStatus} items={[{ id: "needs_action", label: "Needs action" }, { id: "in_progress", label: "In progress" }, { id: "completed", label: "Completed" }]} /> : null}
    {readOnly ? <label className="inspection-status-filter">Status<Dropdown value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All</option><option value="completed">Completed</option></Dropdown></label> : null}
    {state.error ? <p className="inspection-error" role="alert">{state.error}</p> : null}
    {state.loading ? <p role="status">Loading inspections…</p> : <><InspectionQueue inspections={items} projection={projection} projectionForInspection={projectionFor} search={search} onSearchChange={setSearch} onOpen={open} />{nextCursor && items.length < MAX_LIVE_INSPECTION_ROWS ? <button className="inspection-load-more" type="button" onClick={() => load({ cursor: nextCursor, append: true })}>Load more inspections</button> : null}</>}
  </section>;
}
