import { useEffect, useMemo, useRef, useState } from "react";
import { Briefcase02, CheckCircle, Clock, FileCheck02, Inbox01, Plus, RefreshCw01, SearchMd, Tool02 } from "@untitledui/icons";
import { PageHeader } from "../../components/layout/PageHeader.jsx";
import { WorkorderQueueTabs, WorkorderRow, WorkorderTableHeader, workorderMatchesSearch } from "../../components/workorders/WorkorderQueue.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { WorkspaceHeader } from "../../components/layout/WorkspaceHeader.jsx";
import { api } from "../../lib/api.js";
import { useAutomaticRefresh } from "../../hooks/useAutomaticRefresh.js";
import { useWorkorderPreferences } from "../../hooks/useWorkorderPreferences.js";
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

function mechanicStats(rows) {
  const stats = new Map();
  for (const row of rows) {
    for (const name of rowMechanicNames(row)) {
      const current = stats.get(name) || { name, total: 0, active: 0, attention: 0, done: 0 };
      current.total += 1;
      if (["accepted", "in_progress"].includes(lifecycle(row))) current.active += 1;
      if (attentionReasons(row).length) current.attention += 1;
      if (["mechanic_done", "closed", "odoo_entered"].includes(lifecycle(row))) current.done += 1;
      stats.set(name, current);
    }
  }
  return [...stats.values()].sort((a, b) => b.attention - a.attention || b.active - a.active || a.name.localeCompare(b.name));
}

export function OfficeWorkspace({ actor, onCreateWorkorder, onOpenWorkorder }) {
  const [dashboard, setDashboard] = useState(null);
  const [activeTab, setActiveTab] = useState("needs");
  const [search, setSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState("");
  const [mechanicFilter, setMechanicFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const preferenceHydrated = useRef(false);
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
    if (["needs", "open", "active", "parts", "done", "all", "closed"].includes(saved.activeTab)) setActiveTab(saved.activeTab);
    setLifecycleFilter(saved.lifecycleFilter || "");
    setMechanicFilter(saved.mechanicFilter || "");
    setLocationFilter(saved.locationFilter || "");
    preferenceHydrated.current = true;
  }, [queuePreferences.ready]);

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
  const mechanics = useMemo(() => mechanicStats(allRows), [allRows]);
  const locations = useMemo(() => [...new Set(allRows.map((row) => row.locationName).filter(Boolean))].sort(), [allRows]);
  const tabs = [
    { key: "needs", label: "Needs action", count: needsRows.length, icon: Tool02 },
    { key: "open", label: "Unassigned", count: dashboard?.counts.open || 0, icon: Inbox01 },
    { key: "active", label: "Active", count: dashboard?.counts.active || 0, icon: Clock },
    { key: "parts", label: "Parts", count: dashboard?.counts.parts || 0, icon: Tool02 },
    { key: "done", label: "Ready review", count: dashboard?.counts.done || 0, icon: CheckCircle },
    { key: "all", label: "All", count: allRows.length, icon: Briefcase02 },
    { key: "closed", label: "Closed", count: dashboard?.counts.closed || 0, icon: FileCheck02 },
  ];
  const tabRows = activeTab === "needs" ? needsRows
    : activeTab === "all" ? allRows
      : dashboard?.[activeTab] || [];
  const filteredRows = tabRows
    .filter((row) => !lifecycleFilter || lifecycle(row) === lifecycleFilter)
    .filter((row) => !mechanicFilter || rowMechanicNames(row).includes(mechanicFilter))
    .filter((row) => !locationFilter || row.locationName === locationFilter)
    .filter((row) => workorderMatchesSearch(row, search))
    .sort((left, right) => urgency(left) - urgency(right) || new Date(left.updatedAt || left.createdAt) - new Date(right.updatedAt || right.createdAt));

  return (
    <main className="prototype mechanic-home office-home workspace-operations">
      <WorkspaceHeader actor={actor} />
      <PageHeader
        title="Workorders"
        actions={<Button variant="primary" icon={Plus} onClick={onCreateWorkorder}>New workorder</Button>}
      />

      <section className="office-layout">
        <aside className="office-mechanic-panel" aria-label="Mechanic workload">
          <div className="office-panel-head"><strong>Mechanics</strong><span>{mechanics.length}</span></div>
          <button className={!mechanicFilter ? "active" : ""} type="button" onClick={() => setMechanicFilter("")}>
            <span>All mechanics</span><strong>{allRows.length}</strong>
          </button>
          {mechanics.map((mechanic) => (
            <button className={mechanicFilter === mechanic.name ? "active" : ""} key={mechanic.name} type="button" onClick={() => setMechanicFilter(mechanic.name)}>
              <span>{mechanic.name}</span>
              <small>{mechanic.active} active · {mechanic.attention} need attention</small>
              <strong>{mechanic.total}</strong>
            </button>
          ))}
        </aside>

        <section className="mechanic-queue-shell office-table-shell">
          <div className="queue-toolbar office-toolbar">
            <WorkorderQueueTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
            <div className="office-filter-row operations-filter-row">
              <label className="mechanic-search">
                <SearchMd />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search unit, workorder, location, or mechanic" aria-label="Search office workorders" />
              </label>
              {locations.length > 1 ? (
                <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} aria-label="Location filter">
                  <option value="">All locations</option>
                  {locations.map((location) => <option key={location} value={location}>{location}</option>)}
                </select>
              ) : null}
              <select value={lifecycleFilter} onChange={(event) => setLifecycleFilter(event.target.value)} aria-label="Lifecycle filter">
                <option value="">All stages</option>
                <option value="open">Unassigned</option>
                <option value="accepted">Accepted</option>
                <option value="in_progress">In progress</option>
                <option value="mechanic_done">Ready for review</option>
                <option value="closed">Closed</option>
                <option value="odoo_entered">Odoo entered</option>
              </select>
            </div>
          </div>

          {error ? <p className="ops-error" role="alert">{error}</p> : null}
          <WorkorderTableHeader variant="office" />
          <div className="mechanic-work-list" aria-live="polite">
            {loading ? (
              <div className="mechanic-empty-state"><RefreshCw01 className="loading-icon" /><strong>Loading workorders</strong></div>
            ) : filteredRows.length ? filteredRows.map((workorder) => (
              <WorkorderRow key={workorder.id} workorder={workorder} variant="office" onOpen={() => openDetail(workorder.id)} />
            )) : (
              <div className="mechanic-empty-state"><strong>No matching workorders</strong></div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
