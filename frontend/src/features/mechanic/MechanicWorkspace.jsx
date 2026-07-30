import { useEffect, useMemo, useRef, useState } from "react";
import { Briefcase02, Clock, FileCheck02, Inbox01, RefreshCw01, SearchMd, Users01 } from "@untitledui/icons";
import { PageHeader } from "../../components/layout/PageHeader.jsx";
import { textEntryProps } from "../../components/forms/text-entry-policy.js";
import { WorkspaceCreateActions } from "../../components/layout/WorkspaceCreateActions.jsx";
import { WorkspaceHeader } from "../../components/layout/WorkspaceHeader.jsx";
import { WorkorderQueueTabs, WorkorderRow, WorkorderTableHeader, workorderMatchesSearch } from "../../components/workorders/WorkorderQueue.jsx";
import { MobileQueueToolbar } from "../../components/operations/MobileQueueToolbar.jsx";
import { ProgressiveQueue } from "../../components/responsive/ProgressiveQueue.jsx";
import { progressiveQueueResetKey } from "../../components/responsive/ProgressiveQueue.js";
import { api } from "../../lib/api.js";
import { useAutomaticRefresh } from "../../hooks/useAutomaticRefresh.js";
import { useWorkorderPreferences } from "../../hooks/useWorkorderPreferences.js";
import {
  MECHANIC_PRIMARY_TABS,
  MECHANIC_SECONDARY_TABS,
  mechanicActionLabel,
} from "./mechanicWorkspaceConfig.js";
import "../role-workspaces.css";

function workRank(workorder) {
  const reasons = workorder.attentionReasons || [];
  if (reasons.includes("overdue")) return 0;
  if (reasons.includes("parts") || reasons.includes("office_help")) return 2;
  if (workorder.lifecycle === "in_progress" || workorder.status === "in_progress") return 1;
  return 3;
}

export function MechanicWorkspace({ actor, onCreateWorkorder, onOpenWorkorder }) {
  const [dashboard, setDashboard] = useState(null);
  const [activeTab, setActiveTab] = useState("myWork");
  const [search, setSearch] = useState("");
  const [acceptingId, setAcceptingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);
  const preferenceHydrated = useRef(false);
  const queuePreferences = useWorkorderPreferences("mechanic");

  async function loadDashboard() {
    setError("");
    const result = await api("/api/mechanic/dashboard");
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
    { enabled: online },
  );

  useEffect(() => {
    if (!queuePreferences.ready || preferenceHydrated.current) return;
    const savedTab = queuePreferences.filters.activeTab;
    if (["activeWork", "myWork", "openWork", "waiting", "done"].includes(savedTab)) setActiveTab(savedTab);
    preferenceHydrated.current = true;
  }, [queuePreferences.ready]);

  useEffect(() => {
    if (!preferenceHydrated.current) return;
    queuePreferences.save({ activeTab }, { defaultView: activeTab });
  }, [activeTab]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      loadDashboard().catch((err) => setError(err.message));
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  async function openWorkorder(id) {
    setError("");
    try {
      await api(`/api/mechanic/workorders/${id}/opened`, { method: "POST", body: JSON.stringify({}) });
      const detail = await api(`/api/mechanic/workorders/${id}`);
      onOpenWorkorder(detail);
    } catch (err) {
      setError(err.message);
    }
  }

  async function acceptFromCard(id) {
    setAcceptingId(id);
    setError("");
    try {
      await api(`/api/mechanic/workorders/${id}/accept`, { method: "POST", body: JSON.stringify({}) });
      await api(`/api/mechanic/workorders/${id}/opened`, { method: "POST", body: JSON.stringify({}) });
      const detail = await api(`/api/mechanic/workorders/${id}`);
      onOpenWorkorder(detail);
    } catch (err) {
      setError(err.message);
      await loadDashboard();
    } finally {
      setAcceptingId("");
    }
  }

  const tabs = [
    { key: "myWork", label: "My jobs", count: dashboard?.counts.mine || 0, icon: Briefcase02 },
    { key: "openWork", label: "New jobs", count: dashboard?.counts.open || 0, icon: Inbox01 },
    { key: "waiting", label: "Waiting", count: dashboard?.counts.waiting || 0, icon: Clock },
    { key: "done", label: "Work done", count: dashboard?.counts.done || 0, icon: FileCheck02 },
    { key: "activeWork", label: "All active", count: dashboard?.counts.active || 0, icon: Users01 },
  ];
  const mobilePrimaryTabs = MECHANIC_PRIMARY_TABS.map((tab) => ({
    ...tab,
    count: dashboard?.counts[tab.countKey] || 0,
  }));
  const mobileSecondaryTabs = MECHANIC_SECONDARY_TABS.map((tab) => ({
    ...tab,
    count: dashboard?.counts[tab.countKey] || 0,
  }));
  const rows = useMemo(() => (dashboard?.[activeTab] || [])
    .filter((workorder) => workorderMatchesSearch(workorder, search))
    .sort((left, right) => workRank(left) - workRank(right) || new Date(left.updatedAt || left.createdAt) - new Date(right.updatedAt || right.createdAt)), [dashboard, activeTab, search]);

  return (
    <main className="prototype mechanic-home workspace-operations">
      <WorkspaceHeader actor={actor} className="role-home-account-header" />
      <PageHeader
        title="Workorders"
        actions={<WorkspaceCreateActions actor={actor} onCreateWorkorder={onCreateWorkorder} />}
      />

      {!online ? <p className="workspace-connection-state" role="status">Offline. Saved work stays visible; sending and updates resume when connection returns.</p> : null}
      <section className="mechanic-queue-shell">
        <div className="queue-toolbar role-queue-toolbar">
          <div className="role-desktop-queues">
            <WorkorderQueueTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
          </div>
          <MobileQueueToolbar
            className="role-mobile-primary-queues"
            tabs={mobilePrimaryTabs}
            activeTab={activeTab}
            onChange={setActiveTab}
            label="Open mechanic queue search and filters"
            title="Queue search and filters"
            filtersActive={Boolean(search)}
            onClearFilters={() => setSearch("")}
          >
            <div className="role-mobile-secondary-queues">
              <WorkorderQueueTabs tabs={mobileSecondaryTabs} activeTab={activeTab} onChange={setActiveTab} />
            </div>
            <label className="mechanic-search">
              <SearchMd />
              <input {...textEntryProps("search")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search unit or workorder" aria-label="Search workorders" />
            </label>
          </MobileQueueToolbar>
          <label className="mechanic-search role-desktop-search">
            <SearchMd />
            <input {...textEntryProps("search")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search unit or workorder" aria-label="Search workorders" />
          </label>
        </div>

        {error ? <p className="ops-error" role="alert">{error}</p> : null}
        <WorkorderTableHeader variant="mechanic" />
        <div className={`mechanic-work-list role-task-list role-task-list-${activeTab}`} aria-live="polite" data-mobile-action={mechanicActionLabel(activeTab)}>
          {loading ? (
            <div className="mechanic-empty-state"><RefreshCw01 className="loading-icon" /><strong>Loading workorders</strong></div>
          ) : rows.length ? (
            <ProgressiveQueue
              items={rows}
              resetKey={progressiveQueueResetKey([activeTab, search])}
              renderItem={(workorder, index) => (
                <WorkorderRow
                  workorder={workorder}
                  featured={activeTab === "myWork" && index === 0}
                  available={activeTab === "openWork" || (activeTab === "activeWork" && !workorder.mechanicIds?.includes(actor.id))}
                  busy={acceptingId === workorder.id}
                  acceptLabel={activeTab === "activeWork" ? "Join work" : "Accept work"}
                  busyLabel={activeTab === "activeWork" ? "Joining..." : "Accepting..."}
                  onOpen={() => openWorkorder(workorder.id)}
                  onAccept={() => acceptFromCard(workorder.id)}
                />
              )}
            />
          ) : (
            <div className="mechanic-empty-state"><strong>{search ? "No matching jobs" : "No jobs here"}</strong></div>
          )}
        </div>
      </section>
    </main>
  );
}
