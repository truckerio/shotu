import { useEffect, useMemo, useRef, useState } from "react";
import { Briefcase02, CheckCircle, Clock, File02, FileCheck02, Inbox01, Plus, RefreshCw01, SearchMd, Tool02 } from "@untitledui/icons";
import { ProfileMenu } from "../../components/account/ProfileMenu.jsx";
import { PageHeader } from "../../components/layout/PageHeader.jsx";
import { WorkorderQueueTabs, WorkorderRow, WorkorderTableHeader, workorderMatchesSearch } from "../../components/workorders/WorkorderQueue.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { api } from "../../lib/api.js";
import { useAutomaticRefresh } from "../../hooks/useAutomaticRefresh.js";
import { useWorkorderPreferences } from "../../hooks/useWorkorderPreferences.js";
import { WorkorderDraftQueue } from "../workorder-drafts/index.js";
import { MobileQueueTools } from "../../components/operations/MobileQueueTools.jsx";
import { ProgressiveQueue } from "../../components/responsive/ProgressiveQueue.jsx";
import { progressiveQueueResetKey } from "../../components/responsive/ProgressiveQueue.js";
import {
  OFFICE_PRIMARY_TABS,
  OFFICE_SECONDARY_TAB_KEYS,
  officeRowsForTab,
} from "./officeWorkspaceConfig.js";
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

function attentionReasons(row) {
  if (Array.isArray(row.attentionReasons)) return row.attentionReasons;
  if (row.status === "parts_requested") return ["parts"];
  if (row.status === "waiting_office") return ["office_help"];
  return [];
}

function lifecycle(row) {
  if (row.lifecycle) return row.lifecycle;
  return ["parts_requested", "waiting_office"].includes(row.status) ? "in_progress" : row.status;
}

function rowMechanicNames(row) {
  const names = row.mechanics?.map((mechanic) => mechanic.name).filter(Boolean) || [];
  if (names.length) return names;
  return row.mechanicName ? [row.mechanicName] : ["Unassigned"];
}

function needsOfficeAction(row) {
  const reasons = attentionReasons(row);
  return lifecycle(row) === "open" || lifecycle(row) === "mechanic_done" || reasons.some((reason) => ["parts", "office_help", "missing_info", "overdue"].includes(reason));
}

function urgency(row) {
  const reasons = attentionReasons(row);
  if (reasons.includes("missing_info")) return 0;
  if (reasons.includes("overdue")) return 1;
  if (reasons.includes("parts") || reasons.includes("office_help")) return 2;
  if (lifecycle(row) === "mechanic_done") return 3;
  if (lifecycle(row) === "open") return 4;
  return 5;
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
      if (["accepted", "in_progress"].includes(lifecycle(row))) current.active += 1;
      if (attentionReasons(row).length) current.attention += 1;
      if (["mechanic_done", "closed", "odoo_entered"].includes(lifecycle(row))) current.done += 1;
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
    new URLSearchParams(window.location.search).get("view") === "drafts" ? "drafts" : "needs"
  ));
  const [search, setSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState("");
  const [mechanicFilter, setMechanicFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const preferenceHydrated = useRef(false);
  const legacyDraftRoute = useMemo(
    () => new URLSearchParams(window.location.search).get("view") === "drafts",
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
    if (!legacyDraftRoute && ["needs", "open", "active", "parts", "done", "doneOdoo", "drafts", "all", "closed"].includes(saved.activeTab)) setActiveTab(saved.activeTab);
    setLifecycleFilter(saved.lifecycleFilter || "");
    setMechanicFilter(saved.mechanicFilter || "");
    setLocationFilter(saved.locationFilter || "");
    preferenceHydrated.current = true;
  }, [legacyDraftRoute, queuePreferences.ready]);

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

  const allRows = useMemo(() => buildOfficeRows(dashboard), [dashboard]);
  const needsRows = useMemo(() => allRows.filter(needsOfficeAction), [allRows]);
  const mechanics = useMemo(() => mechanicStats(allRows, dashboard?.mechanics), [allRows, dashboard?.mechanics]);
  const locations = useMemo(() => [...new Set(allRows.map((row) => row.locationName).filter(Boolean))].sort(), [allRows]);
  const tabs = [
    { key: "needs", label: "Needs action", count: needsRows.length, icon: Tool02 },
    { key: "open", label: "Unassigned", count: dashboard?.counts.open || 0, icon: Inbox01 },
    { key: "active", label: "Active", count: dashboard?.counts.active || 0, icon: Clock },
    { key: "parts", label: "Parts", count: dashboard?.counts.parts || 0, icon: Tool02 },
    { key: "done", label: "Ready review", count: dashboard?.counts.done || 0, icon: CheckCircle },
    { key: "drafts", label: "Drafts", count: drafts.length, icon: File02 },
    { key: "all", label: "All", count: allRows.length, icon: Briefcase02 },
    { key: "closed", label: "Closed", count: dashboard?.counts.closed || 0, icon: FileCheck02 },
  ];
  const mobilePrimaryTabs = OFFICE_PRIMARY_TABS.map((tab) => ({
    ...tab,
    count: tab.key === "needs"
      ? needsRows.length
      : tab.key === "active"
        ? dashboard?.counts.active || 0
        : (dashboard?.counts.done || 0) + (dashboard?.counts.closed || 0),
  }));
  const mobileSecondaryTabs = tabs.filter((tab) => OFFICE_SECONDARY_TAB_KEYS.includes(tab.key));
  const tabRows = officeRowsForTab(activeTab, dashboard, allRows, needsRows);
  const filteredRows = tabRows
    .filter((row) => !lifecycleFilter || lifecycle(row) === lifecycleFilter)
    .filter((row) => !mechanicFilter || rowMechanicNames(row).includes(mechanicFilter))
    .filter((row) => !locationFilter || row.locationName === locationFilter)
    .filter((row) => workorderMatchesSearch(row, search))
    .sort((left, right) => urgency(left) - urgency(right) || new Date(left.updatedAt || left.createdAt) - new Date(right.updatedAt || right.createdAt));

  return (
    <main className="prototype mechanic-home office-home workspace-operations">
      <PageHeader
        title={<ProfileMenu actor={actor} wordmark />}
        actions={<Button variant="primary" icon={Plus} onClick={onCreateWorkorder}>New workorder</Button>}
      />

      <section className={`office-layout${activeTab === "drafts" ? " is-drafts" : ""}`}>
        {activeTab !== "drafts" ? <aside className="office-mechanic-panel" aria-label="Mechanic workload">
          <div className="office-panel-head"><strong>Mechanics</strong><span>{mechanics.length}</span></div>
          <button className={!mechanicFilter ? "active" : ""} type="button" onClick={() => setMechanicFilter("")}>
            <span>All mechanics</span><strong>{allRows.length}</strong>
          </button>
          {mechanics.map((mechanic) => (
            <button className={mechanicFilter === mechanic.name ? "active" : ""} key={mechanic.id || mechanic.name} type="button" onClick={() => setMechanicFilter(mechanic.name)}>
              <span>{mechanic.name}</span>
              <small>{mechanic.active} active · {mechanic.attention} need attention</small>
              <strong>{mechanic.total}</strong>
            </button>
          ))}
        </aside> : null}

        <section className="mechanic-queue-shell office-table-shell">
          <div className="queue-toolbar office-toolbar role-queue-toolbar">
            <div className="role-desktop-queues">
              <WorkorderQueueTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
            </div>
            <div className="role-mobile-primary-queues">
              <WorkorderQueueTabs tabs={mobilePrimaryTabs} activeTab={activeTab} onChange={setActiveTab} />
            </div>
            {activeTab !== "drafts" ? <div className="office-filter-row operations-filter-row role-desktop-filters">
                  <label className="mechanic-search">
                    <SearchMd />
                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search unit, workorder, location, or mechanic" aria-label="Search office workorders" />
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
                  </select>
                </div> : null}
            <MobileQueueTools
              label="Open office queues, search, and filters"
              title="Queues, search, and filters"
              filtersActive={Boolean(search || mechanicFilter || locationFilter || lifecycleFilter)}
              onClearFilters={() => { setSearch(""); setMechanicFilter(""); setLocationFilter(""); setLifecycleFilter(""); }}
            >
              <div className="role-mobile-secondary-queues">
                <WorkorderQueueTabs tabs={mobileSecondaryTabs} activeTab={activeTab} onChange={setActiveTab} />
              </div>
              {activeTab !== "drafts" ? <>
                <label className="mechanic-search">
                  <SearchMd />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search unit, workorder, location, or mechanic" aria-label="Search office workorders" />
                </label>
                <label><span>Mechanic</span><select value={mechanicFilter} onChange={(event) => setMechanicFilter(event.target.value)}><option value="">All mechanics</option>{mechanics.map((mechanic) => <option key={mechanic.id || mechanic.name} value={mechanic.name}>{mechanic.name}</option>)}</select></label>
                {locations.length > 1 ? <label><span>Location</span><select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="">All locations</option>{locations.map((location) => <option key={location} value={location}>{location}</option>)}</select></label> : null}
                <label><span>Stage</span><select value={lifecycleFilter} onChange={(event) => setLifecycleFilter(event.target.value)}><option value="">All stages</option><option value="open">Unassigned</option><option value="accepted">Accepted</option><option value="in_progress">In progress</option><option value="mechanic_done">Ready for review</option><option value="closed">Closed</option><option value="odoo_entered">Odoo entered</option></select></label>
              </> : null}
            </MobileQueueTools>
          </div>

          {activeTab === "drafts" ? (
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
                    renderItem={(workorder) => (
                      <WorkorderRow workorder={workorder} variant="office" onOpen={() => openDetail(workorder.id)} />
                    )}
                  />
                ) : (
                  <div className="mechanic-empty-state"><strong>No matching workorders</strong></div>
                )}
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
