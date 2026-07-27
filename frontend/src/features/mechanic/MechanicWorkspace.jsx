import { useEffect, useMemo, useRef, useState } from "react";
import { Briefcase02, Clock, FileCheck02, Inbox01, Plus, RefreshCw01, SearchMd, Users01 } from "@untitledui/icons";
import { PageHeader } from "../../components/layout/PageHeader.jsx";
import { WorkorderQueueTabs, WorkorderRow, WorkorderTableHeader, workorderMatchesSearch } from "../../components/workorders/WorkorderQueue.jsx";
import { WorkspaceHeader } from "../../components/layout/WorkspaceHeader.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { api } from "../../lib/api.js";
import { useAutomaticRefresh } from "../../hooks/useAutomaticRefresh.js";
import { useWorkorderPreferences } from "../../hooks/useWorkorderPreferences.js";
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
    { key: "activeWork", label: "Active", count: dashboard?.counts.active || 0, icon: Users01 },
    { key: "myWork", label: "My jobs", count: dashboard?.counts.mine || 0, icon: Briefcase02 },
    { key: "openWork", label: "New jobs", count: dashboard?.counts.open || 0, icon: Inbox01 },
    { key: "waiting", label: "Waiting", count: dashboard?.counts.waiting || 0, icon: Clock },
    { key: "done", label: "Finished", count: dashboard?.counts.done || 0, icon: FileCheck02 },
  ];
  const rows = useMemo(() => (dashboard?.[activeTab] || [])
    .filter((workorder) => workorderMatchesSearch(workorder, search))
    .sort((left, right) => workRank(left) - workRank(right) || new Date(left.updatedAt || left.createdAt) - new Date(right.updatedAt || right.createdAt)), [dashboard, activeTab, search]);

  return (
    <main className="prototype mechanic-home workspace-operations">
      <WorkspaceHeader actor={actor} />
      <PageHeader
        title="Workorders"
        actions={<Button type="button" variant="primary" icon={Plus} onClick={onCreateWorkorder}>New workorder</Button>}
      />

      {!online ? <p className="workspace-connection-state" role="status">Offline. Saved work stays visible; sending and updates resume when connection returns.</p> : null}
      <section className="mechanic-queue-shell">
        <div className="queue-toolbar">
          <WorkorderQueueTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
          <label className="mechanic-search">
            <SearchMd />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search unit or workorder" aria-label="Search workorders" />
          </label>
        </div>

        {error ? <p className="ops-error" role="alert">{error}</p> : null}
        <WorkorderTableHeader variant="mechanic" />
        <div className="mechanic-work-list" aria-live="polite">
          {loading ? (
            <div className="mechanic-empty-state"><RefreshCw01 className="loading-icon" /><strong>Loading workorders</strong></div>
          ) : rows.length ? rows.map((workorder, index) => (
            <WorkorderRow
              key={workorder.id}
              workorder={workorder}
              featured={activeTab === "myWork" && index === 0}
              available={activeTab === "openWork" || (activeTab === "activeWork" && !workorder.mechanicIds?.includes(actor.id))}
              busy={acceptingId === workorder.id}
              acceptLabel={activeTab === "activeWork" ? "Join work" : "Accept work"}
              busyLabel={activeTab === "activeWork" ? "Joining..." : "Accepting..."}
              onOpen={() => openWorkorder(workorder.id)}
              onAccept={() => acceptFromCard(workorder.id)}
            />
          )) : (
            <div className="mechanic-empty-state"><strong>{search ? "No matching jobs" : "No jobs here"}</strong></div>
          )}
        </div>
      </section>
    </main>
  );
}
