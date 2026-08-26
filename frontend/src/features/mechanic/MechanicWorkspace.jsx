import { useEffect, useMemo, useState } from "react";
import { Briefcase02, Clock, FileCheck02, Inbox01, RefreshCw01, SearchMd, Users01 } from "@untitledui/icons";
import { PageHeader } from "../../components/layout/PageHeader.jsx";
import { textEntryProps } from "../../components/forms/text-entry-policy.js";
import { WorkspaceCreateActions } from "../../components/layout/WorkspaceCreateActions.jsx";
import { WorkspaceHeader } from "../../components/layout/WorkspaceHeader.jsx";
import { WorkorderQueueTabs, WorkorderRow, WorkorderTableHeader, workorderMatchesSearch } from "../../components/workorders/WorkorderQueue.jsx";
import { ProgressiveQueue } from "../../components/responsive/ProgressiveQueue.jsx";
import { progressiveQueueResetKey } from "../../components/responsive/ProgressiveQueue.js";
import { api } from "../../lib/api.js";
import { useAutomaticRefresh } from "../../hooks/useAutomaticRefresh.js";
import { LocaleSelector } from "../../i18n/LocaleSelector.jsx";
import { interfaceText } from "../../i18n/index.js";
import {
  MECHANIC_QUEUE_TABS,
  mechanicActionLabel,
  mechanicQueueTabsForViewport,
} from "./mechanicWorkspaceConfig.js";
import {
  buildMechanicHomeView,
  compareMechanicJobs,
  mechanicJobActionKey,
} from "./mechanic-workspace-model.js";
import "./mechanic-workspace.css";
import "../role-workspaces.css";

function jobUnit(workorder) {
  return workorder.assetUnitNo || workorder.assetLabel || workorder.asset?.unitNo || workorder.asset?.name || "Unit not set";
}

function jobLocation(workorder) {
  return workorder.locationName || workorder.location?.name || "Location not set";
}

export function MechanicWorkspace({ actor, locale = "en", localeError = "", onLocaleChange, onCreateWorkorder, onOpenWorkorder }) {
  const t = (key) => interfaceText(locale, key);
  const [dashboard, setDashboard] = useState(null);
  const [activeTab, setActiveTab] = useState("myWork");
  const [search, setSearch] = useState("");
  const [acceptingId, setAcceptingId] = useState("");
  const [openingId, setOpeningId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);

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
    setOpeningId(id);
    setError("");
    try {
      await api(`/api/mechanic/workorders/${id}/opened`, { method: "POST", body: JSON.stringify({}) });
      const detail = await api(`/api/mechanic/workorders/${id}`);
      onOpenWorkorder(detail);
    } catch (err) {
      setError(err.message);
      await loadDashboard().catch(() => {});
    } finally {
      setOpeningId("");
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

  const homeView = useMemo(() => buildMechanicHomeView(dashboard), [dashboard]);
  const secondaryIcons = { waiting: Clock, done: FileCheck02, activeWork: Users01 };
  const queueTabs = MECHANIC_QUEUE_TABS.map((tab) => ({
    ...tab,
    label: t(tab.labelKey),
    count: dashboard?.counts[tab.countKey] || 0,
    icon: tab.key === "myWork" ? Briefcase02 : tab.key === "openWork" ? Inbox01 : secondaryIcons[tab.key],
  }));
  const phoneQueueKeys = mechanicQueueTabsForViewport(true);
  const phonePrimaryTabs = queueTabs.filter((tab) => phoneQueueKeys.primary.some(({ key }) => key === tab.key));
  const phoneSecondaryTabs = queueTabs.filter((tab) => phoneQueueKeys.secondary.some(({ key }) => key === tab.key));
  const nextJob = activeTab === "myWork" ? homeView.nextJob : null;
  const activeRows = activeTab === "myWork"
    ? homeView.assignedJobs
    : activeTab === "openWork"
      ? homeView.availableJobs
      : activeTab === "waiting"
        ? homeView.waitingJobs
        : activeTab === "done"
          ? homeView.historyJobs
          : dashboard?.activeWork || [];
  const rows = useMemo(() => activeRows
    .filter((workorder) => workorderMatchesSearch(workorder, search))
    .sort(compareMechanicJobs), [activeRows, search]);

  const emptyAssigned = !loading && activeTab === "myWork" && !nextJob;

  return (
    <main className="prototype mechanic-home workspace-operations">
      <WorkspaceHeader actor={actor} className="role-home-account-header" />
      <div className="mechanic-home-content">
        <PageHeader
          title={t("mechanic.workorders")}
          actions={(
            <WorkspaceCreateActions
              actor={actor}
              onCreateWorkorder={onCreateWorkorder}
              createLabel={t("mechanic.createWorkorder")}
            />
          )}
        />

        {!online ? <p className="workspace-connection-state" role="status">Offline. Saved work stays visible; sending and updates resume when connection returns.</p> : null}
        <section className="mechanic-queue-shell" aria-label="Mechanic work">
          <div className="mechanic-primary-queues">
            <div className="mechanic-wide-queues">
              <WorkorderQueueTabs tabs={queueTabs} activeTab={activeTab} onChange={setActiveTab} />
            </div>
            <div className="mechanic-phone-queues">
              <WorkorderQueueTabs tabs={phonePrimaryTabs} activeTab={activeTab} onChange={setActiveTab} />
            </div>
          </div>

          <section className="mechanic-visible-tools" aria-label="Search and filters">
            <label className="mechanic-search">
              <SearchMd aria-hidden="true" />
              <input aria-label="Search workorders" {...textEntryProps("search")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search unit or workorder" />
            </label>
            <div className="mechanic-secondary-actions mechanic-wide-account-actions">
              <LocaleSelector locale={locale} onChange={onLocaleChange} error={localeError} />
            </div>
          </section>

          {error ? <p className="ops-error" role="alert">{error}</p> : null}

          {loading ? (
            <div className="mechanic-empty-state"><RefreshCw01 className="loading-icon" /><strong>Loading workorders</strong></div>
          ) : nextJob ? (
            <section className="mechanic-next-job" aria-label={t("mechanic.nextJob")}>
              <div className="mechanic-next-job-copy">
                <span className="mechanic-next-job-eyebrow">{t("mechanic.upNext")}</span>
                <h2>{t("mechanic.nextJob")}</h2>
                <strong className="mechanic-next-job-unit">{jobUnit(nextJob)}</strong>
                <p>{nextJob.concern || "Problem not recorded"}</p>
                <span>{jobLocation(nextJob)}{nextJob.serial ? ` · ${nextJob.serial}` : ""}</span>
              </div>
              <button
                className="button primary mechanic-next-job-action"
                type="button"
                disabled={openingId === nextJob.id}
                onClick={() => openWorkorder(nextJob.id)}
              >
                {openingId === nextJob.id
                  ? "Opening…"
                  : t(`mechanic.${mechanicJobActionKey(nextJob)}`)}
              </button>
            </section>
          ) : null}

          {emptyAssigned ? (
            <div className="mechanic-empty-state mechanic-assigned-empty">
              <strong>{t("mechanic.noAssignedJobs")}</strong>
              <span>{t("mechanic.readyForJob")}</span>
              {homeView.availableJobs.length ? <button type="button" onClick={() => setActiveTab("openWork")}>{t("mechanic.viewAvailable")}</button> : null}
            </div>
          ) : null}

          {!loading && (activeTab !== "myWork" || rows.length) ? (
            <section className="mechanic-assigned-list" aria-label={activeTab === "myWork" ? "Other assigned jobs" : "Workorders"}>
              <div className="mechanic-list-title">
                <h2>{activeTab === "myWork" ? t("mechanic.otherAssigned") : queueTabs.find((tab) => tab.key === activeTab)?.label}</h2>
                <span>{rows.length}</span>
              </div>
              <WorkorderTableHeader variant="mechanic" />
              <div className={`mechanic-work-list role-task-list role-task-list-${activeTab}`} aria-live="polite" data-mobile-action={mechanicActionLabel(activeTab)}>
                {rows.length ? (
                  <ProgressiveQueue
                    items={rows}
                    resetKey={progressiveQueueResetKey([activeTab, search])}
                    renderItem={(workorder) => (
                      <WorkorderRow
                        workorder={workorder}
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
                  <div className="mechanic-empty-state">
                    <strong>{search ? "No matching jobs" : "No jobs here"}</strong>
                    {search ? <button type="button" onClick={() => setSearch("")}>Clear search</button> : null}
                  </div>
                )}
              </div>
            </section>
          ) : null}

          <details className="mechanic-home-more">
            <summary><span>{t("detail.more")}</span><small>{t("mechanic.moreSummary")}</small></summary>
            <div className="mechanic-home-more-body">
              <div className="mechanic-secondary-queues">
                <WorkorderQueueTabs tabs={phoneSecondaryTabs} activeTab={activeTab} onChange={setActiveTab} />
              </div>
              <section className="mechanic-secondary-tools" aria-label="Account controls">
                <div className="mechanic-secondary-actions">
                  <LocaleSelector locale={locale} onChange={onLocaleChange} error={localeError} />
                </div>
              </section>
            </div>
          </details>
        </section>
      </div>
    </main>
  );
}
