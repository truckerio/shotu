import { useEffect, useMemo, useRef, useState } from "react";
import { Briefcase02, CheckCircle, Clock, File02, FileCheck02, Inbox01, RefreshCw01, SearchMd, Tool02 } from "@untitledui/icons";
import { PageHeader } from "../../components/layout/PageHeader.jsx";
import { textEntryProps } from "../../components/forms/text-entry-policy.js";
import { WorkspaceCreateActions } from "../../components/layout/WorkspaceCreateActions.jsx";
import { WorkspaceHeader } from "../../components/layout/WorkspaceHeader.jsx";
import { WorkorderQueueTabs, WorkorderRow, WorkorderTableHeader, workorderMatchesSearch } from "../../components/workorders/WorkorderQueue.jsx";
import { api } from "../../lib/api.js";
import { useAutomaticRefresh } from "../../hooks/useAutomaticRefresh.js";
import { useWorkorderPreferences } from "../../hooks/useWorkorderPreferences.js";
import { WorkorderDraftQueue } from "../workorder-drafts/index.js";
import { MobileQueueToolbar } from "../../components/operations/MobileQueueToolbar.jsx";
import { ProgressiveQueue } from "../../components/responsive/ProgressiveQueue.jsx";
import { progressiveQueueResetKey } from "../../components/responsive/ProgressiveQueue.js";
import { InvoiceExtractionWorkspace } from "./InvoiceExtractionWorkspace.jsx";
import {
  OFFICE_PRIMARY_TABS,
  OFFICE_SECONDARY_TAB_KEYS,
  needsOfficeAction,
  officeAttentionReasons,
  officeHandoffSummary,
  officeLifecycle,
  officeQueueFilterState,
  officeQueueForViewport,
  officeRowsForTab,
  officeTabForMechanicFilter,
  officeUrgency,
} from "./officeWorkspaceConfig.js";
import "./office.css";
import "../role-workspaces.css";

function uniqueRows(...groups) {
  const rows = groups.flat().filter(Boolean);
  const seen = new Set();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function buildOfficeRows(dashboard) {
  if (!dashboard) return [];
  return uniqueRows(dashboard.open, dashboard.active, dashboard.parts, dashboard.done, dashboard.closed);
}

function rowMechanicNames(row) {
  const names = row.mechanics?.map((mechanic) => mechanic.name).filter(Boolean) || [];
  if (names.length) return names;
  return row.mechanicName ? [row.mechanicName] : ["Unassigned"];
}

function mechanicStats(rows, roster = []) {
  const stats = new Map();
  for (const mechanic of roster) {
    stats.set(mechanic.id || mechanic.name, {
      id: mechanic.id,
      name: mechanic.name,
      total: 0,
      active: 0,
      attention: 0,
      done: 0,
    });
  }
  for (const row of rows) {
    const assigned = row.mechanics?.length
      ? row.mechanics
      : row.mechanicName ? [{ id: row.mechanicId, name: row.mechanicName }] : [];
    for (const mechanic of assigned) {
      const key = mechanic.id || mechanic.name;
      const current = stats.get(key) || {
        id: mechanic.id,
        name: mechanic.name,
        total: 0,
        active: 0,
        attention: 0,
        done: 0,
      };
      current.total += 1;
      if (["accepted", "in_progress"].includes(officeLifecycle(row))) current.active += 1;
      if (officeAttentionReasons(row).length) current.attention += 1;
      if (["mechanic_done", "closed", "odoo_entered"].includes(officeLifecycle(row))) current.done += 1;
      stats.set(key, current);
    }
  }
  return [...stats.values()].sort((a, b) => b.attention - a.attention || b.active - a.active || a.name.localeCompare(b.name));
}

export function OfficeWorkspace({
  actor,
  drafts = [],
  draftLoading = false,
  draftError = "",
  draftBusyId = "",
  onCreateWorkorder,
  onOpenDraft,
  onDiscardDraft,
  onTakeoverDraft,
  onRefreshDrafts,
  onOpenWorkorder,
}) {
  const [dashboard, setDashboard] = useState(null);
  const [activeTab, setActiveTab] = useState(() => (
    ["drafts", "invoices"].includes(new URLSearchParams(window.location.search).get("view"))
      ? new URLSearchParams(window.location.search).get("view")
      : "needs"
  ));
  const [search, setSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState("");
  const [mechanicFilter, setMechanicFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const preferenceHydrated = useRef(false);
  const requestedWorkspace = useMemo(
    () => {
      const requested = new URLSearchParams(window.location.search).get("view");
      return ["drafts", "invoices"].includes(requested) ? requested : "";
    },
    [],
  );
  const queuePreferences = useWorkorderPreferences("office");

  async function loadDashboard() {
    setError("");
    const result = await api("/api/office/dashboard");
    setDashboard(result);
    setLoading(false);
  }

  useEffect(() => {
    loadDashboard().catch((err) => {
      setError(err.message);
      setLoading(false);
    });
  }, []);
  useAutomaticRefresh(
    () => loadDashboard().catch((err) => setError(err.message)),
  );

  useEffect(() => {
    if (!queuePreferences.ready || preferenceHydrated.current) return;
    const saved = queuePreferences.filters;
    const savedTabCandidate = !requestedWorkspace && ["needs", "open", "active", "parts", "done", "doneOdoo", "drafts", "invoices", "all", "closed"].includes(saved.activeTab)
      ? saved.activeTab
      : requestedWorkspace || "needs";
    const savedTab = officeQueueForViewport(
      savedTabCandidate,
      window.matchMedia("(max-width: 700px)").matches,
    );
    const normalized = officeQueueFilterState(savedTab, saved);
    setActiveTab(normalized.activeTab);
    setLifecycleFilter(normalized.lifecycleFilter);
    setMechanicFilter(normalized.mechanicFilter);
    setLocationFilter(saved.locationFilter || "");
    preferenceHydrated.current = true;
  }, [requestedWorkspace, queuePreferences.ready]);

  useEffect(() => {
    const phoneQuery = window.matchMedia("(max-width: 700px)");
    function normalizeDesktopQueue(event) {
      if (!event.matches) {
        setActiveTab((current) => officeQueueForViewport(current, false));
      }
    }
    phoneQuery.addEventListener("change", normalizeDesktopQueue);
    return () => phoneQuery.removeEventListener("change", normalizeDesktopQueue);
  }, []);

  useEffect(() => {
    if (!preferenceHydrated.current) return;
    queuePreferences.save(
      { activeTab, lifecycleFilter, mechanicFilter, locationFilter },
      { defaultView: activeTab },
    );
  }, [activeTab, lifecycleFilter, mechanicFilter, locationFilter]);

  async function openDetail(id) {
    setError("");
    try {
      await onOpenWorkorder(id);
    } catch (err) {
      setError(err.message);
    }
  }

  function selectQueue(nextTab) {
    const normalized = officeQueueFilterState(nextTab, { lifecycleFilter, mechanicFilter });
    setActiveTab(normalized.activeTab);
    setLifecycleFilter(normalized.lifecycleFilter);
    setMechanicFilter(normalized.mechanicFilter);
  }

  function selectMechanic(nextMechanic) {
    setMechanicFilter(nextMechanic);
    setActiveTab((current) => officeTabForMechanicFilter(current, nextMechanic));
  }

  function clearOfficeFilters() {
    setSearch("");
    setMechanicFilter("");
    setLocationFilter("");
    setLifecycleFilter("");
  }

  const allRows = useMemo(() => buildOfficeRows(dashboard), [dashboard]);
  const needsRows = useMemo(() => allRows.filter(needsOfficeAction), [allRows]);
  const mechanics = useMemo(() => mechanicStats(allRows, dashboard?.mechanics), [allRows, dashboard?.mechanics]);
  const locations = useMemo(() => [...new Set(allRows.map((row) => row.locationName).filter(Boolean))].sort(), [allRows]);
  const doneOdooRows = useMemo(
    () => officeRowsForTab("doneOdoo", dashboard, allRows, needsRows),
    [allRows, dashboard, needsRows],
  );
  const tabs = [
    { key: "needs", label: "Needs action", count: needsRows.length, icon: Tool02 },
    { key: "open", label: "Unassigned", count: dashboard?.open?.length || 0, icon: Inbox01 },
    { key: "active", label: "Active", count: dashboard?.active?.length || 0, icon: Clock },
    { key: "parts", label: "Parts", count: dashboard?.parts?.length || 0, icon: Tool02 },
    { key: "done", label: "Ready review", count: dashboard?.done?.length || 0, icon: CheckCircle },
    { key: "drafts", label: "Drafts", count: drafts.length, icon: File02 },
    { key: "invoices", label: "Invoices", count: null, icon: FileCheck02 },
    { key: "all", label: "All", count: allRows.length, icon: Briefcase02 },
    { key: "closed", label: "Closed", count: dashboard?.closed?.length || 0, icon: FileCheck02 },
  ];
  const mobilePrimaryTabs = OFFICE_PRIMARY_TABS.map((tab) => ({
    ...tab,
    count: tab.key === "needs"
      ? needsRows.length
      : tab.key === "active"
        ? dashboard?.active?.length || 0
        : doneOdooRows.length,
  }));
  const mobileSecondaryTabs = tabs.filter((tab) => OFFICE_SECONDARY_TAB_KEYS.includes(tab.key) || tab.key === "invoices");
  const tabRows = activeTab === "invoices" ? [] : officeRowsForTab(activeTab, dashboard, allRows, needsRows);
  const filteredRows = tabRows
    .filter((row) => !lifecycleFilter || officeLifecycle(row) === lifecycleFilter)
    .filter((row) => !mechanicFilter || rowMechanicNames(row).includes(mechanicFilter))
    .filter((row) => !locationFilter || row.locationName === locationFilter)
    .filter((row) => workorderMatchesSearch(row, search))
    .sort((left, right) => officeUrgency(left) - officeUrgency(right) || new Date(left.updatedAt || left.createdAt) - new Date(right.updatedAt || right.createdAt));

  return (
    <main className="prototype mechanic-home office-home workspace-operations">
      <WorkspaceHeader actor={actor} className="role-home-account-header" />
      <PageHeader
        title="Workorders"
        actions={<WorkspaceCreateActions actor={actor} onCreateWorkorder={onCreateWorkorder} />}
      />

      <section className={`office-layout${["drafts", "invoices"].includes(activeTab) ? " is-drafts" : ""}`}>
        {!["drafts", "invoices"].includes(activeTab) ? <aside className="office-mechanic-panel" aria-label="Mechanic workload">
          <div className="office-panel-head"><strong>Mechanics</strong><span>{mechanics.length}</span></div>
          <button className={!mechanicFilter ? "active" : ""} type="button" onClick={() => selectMechanic("")}>
            <span>All mechanics</span><strong>{allRows.length}</strong>
          </button>
          {mechanics.map((mechanic) => (
            <button className={mechanicFilter === mechanic.name ? "active" : ""} key={mechanic.id || mechanic.name} type="button" onClick={() => selectMechanic(mechanic.name)}>
              <span>{mechanic.name}</span>
              <small>{mechanic.active} active · {mechanic.attention} need attention</small>
              <strong>{mechanic.total}</strong>
            </button>
          ))}
        </aside> : null}

        <section className="mechanic-queue-shell office-table-shell">
          <div className="queue-toolbar office-toolbar role-queue-toolbar">
            <div className="role-desktop-queues">
              <WorkorderQueueTabs tabs={tabs} activeTab={activeTab} onChange={selectQueue} />
            </div>
            <MobileQueueToolbar
              className="role-mobile-primary-queues"
              tabs={mobilePrimaryTabs}
              activeTab={activeTab}
              onChange={selectQueue}
              label="Open office queues, search, and filters"
              title="Queues, search, and filters"
              filtersActive={Boolean(search || mechanicFilter || locationFilter || lifecycleFilter)}
              onClearFilters={clearOfficeFilters}
            >
              <div className="role-mobile-secondary-queues">
                <WorkorderQueueTabs tabs={mobileSecondaryTabs} activeTab={activeTab} onChange={selectQueue} />
              </div>
              {!["drafts", "invoices"].includes(activeTab) ? <>
                <label className="mechanic-search">
                  <SearchMd />
                  <input {...textEntryProps("search")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search unit, workorder, location, or mechanic" aria-label="Search office workorders" />
                </label>
                <label><span>Mechanic</span><select value={mechanicFilter} onChange={(event) => selectMechanic(event.target.value)}><option value="">All mechanics</option>{mechanics.map((mechanic) => <option key={mechanic.id || mechanic.name} value={mechanic.name}>{mechanic.name}</option>)}</select></label>
                {locations.length > 1 ? <label><span>Location</span><select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="">All locations</option>{locations.map((location) => <option key={location} value={location}>{location}</option>)}</select></label> : null}
                <label><span>Stage</span><select value={lifecycleFilter} onChange={(event) => setLifecycleFilter(event.target.value)}><option value="">All stages</option><option value="open">Unassigned</option><option value="accepted">Accepted</option><option value="in_progress">In progress</option><option value="mechanic_done">Ready for review</option><option value="closed">Closed</option><option value="odoo_entered">Odoo entered</option><option value="cancelled">Cancelled</option></select></label>
              </> : null}
            </MobileQueueToolbar>
            {!["drafts", "invoices"].includes(activeTab) ? <div className="office-filter-row operations-filter-row role-desktop-filters">
                  <label className="mechanic-search">
                    <SearchMd />
                    <input {...textEntryProps("search")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search unit, workorder, location, or mechanic" aria-label="Search office workorders" />
                  </label>
                  {locations.length > 1 ? (
                    <select className="office-inline-filter" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} aria-label="Location filter">
                      <option value="">All locations</option>
                      {locations.map((location) => <option key={location} value={location}>{location}</option>)}
                    </select>
                  ) : null}
                  <select className="office-inline-filter" value={lifecycleFilter} onChange={(event) => setLifecycleFilter(event.target.value)} aria-label="Lifecycle filter">
                    <option value="">All stages</option>
                    <option value="open">Unassigned</option>
                    <option value="accepted">Accepted</option>
                    <option value="in_progress">In progress</option>
                    <option value="mechanic_done">Ready for review</option>
                    <option value="closed">Closed</option>
                    <option value="odoo_entered">Odoo entered</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div> : null}
          </div>

          {activeTab === "invoices" ? (
            <InvoiceExtractionWorkspace />
          ) : activeTab === "drafts" ? (
            <WorkorderDraftQueue
              role={actor.role}
              actorId={actor.id}
              drafts={drafts}
              loading={draftLoading}
              error={draftError}
              busyId={draftBusyId}
              onOpen={onOpenDraft}
              onDiscard={onDiscardDraft}
              onTakeover={onTakeoverDraft}
              onRefresh={onRefreshDrafts}
            />
          ) : (
            <>
              {error ? <p className="ops-error" role="alert">{error}</p> : null}
              <WorkorderTableHeader variant="office" />
              <div className="mechanic-work-list" aria-live="polite">
                {loading ? (
                  <div className="mechanic-empty-state"><RefreshCw01 className="loading-icon" /><strong>Loading workorders</strong></div>
                ) : filteredRows.length ? (
                  <ProgressiveQueue
                    items={filteredRows}
                    resetKey={progressiveQueueResetKey([
                      activeTab,
                      search,
                      lifecycleFilter,
                      mechanicFilter,
                      locationFilter,
                    ])}
                    renderItem={(workorder) => {
                      const handoff = activeTab === "needs" ? officeHandoffSummary(workorder) : null;
                      return (
                        <div className={`office-queue-task${handoff ? " has-handoff" : ""}`}>
                          {handoff ? (
                            <div className={`office-handoff-callout is-${handoff.reason}`}>
                              <strong>{handoff.label}</strong>
                              {handoff.note ? <span>{handoff.note}</span> : null}
                            </div>
                          ) : null}
                          <WorkorderRow workorder={workorder} variant="office" onOpen={() => openDetail(workorder.id)} />
                        </div>
                      );
                    }}
                  />
                ) : (
                  <div className="mechanic-empty-state">
                    <strong>No matching workorders</strong>
                    {search || mechanicFilter || locationFilter || lifecycleFilter ? (
                      <>
                        <span>Current filters hide this queue.</span>
                        <button type="button" onClick={clearOfficeFilters}>Clear filters</button>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
