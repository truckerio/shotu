import { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatLocaleNumber, interfaceText } from "../../i18n/index.js";
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

function jobUnit(workorder, fallback) {
  return workorder.assetUnitNo || workorder.assetLabel || workorder.asset?.unitNo || workorder.asset?.name || fallback;
}

function jobLocation(workorder, fallback) {
  return workorder.locationName || workorder.location?.name || fallback;
}

export function MechanicWorkspace({ actor, locale = "en", localeError = "", localeReady = true, onLocaleChange, onCreateWorkorder, onOpenWorkorder }) {
  const t = (key) => interfaceText(locale, key);
  const errorText = useCallback(
    (error) => locale === "en" && error?.message ? error.message : interfaceText(locale, "mechanic.requestFailed"),
    [locale],
  );
  const [dashboard, setDashboard] = useState(null);
  const [activeTab, setActiveTab] = useState("myWork");
  const [search, setSearch] = useState("");
  const [acceptingId, setAcceptingId] = useState("");
  const [openingId, setOpeningId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);

  const loadDashboard = useCallback(async () => {
    setError("");
    const result = await api("/api/mechanic/dashboard");
    setDashboard(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDashboard().catch((err) => {
      setError(errorText(err));
      setLoading(false);
    });
  }, [errorText, loadDashboard]);
  useAutomaticRefresh(
    () => loadDashboard().catch((err) => setError(errorText(err))),
    { enabled: online },
  );

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      loadDashboard().catch((err) => setError(errorText(err)));
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [errorText, loadDashboard]);

  async function openWorkorder(id) {
    setOpeningId(id);
    setError("");
    try {
      await api(`/api/mechanic/workorders/${id}/opened`, { method: "POST", body: JSON.stringify({}) });
      const detail = await api(`/api/mechanic/workorders/${id}`);
      onOpenWorkorder(detail);
    } catch (err) {
      setError(errorText(err));
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
      setError(errorText(err));
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
      <WorkspaceHeader actor={actor} className="role-home-account-header" locale={locale} />
      <div className="mechanic-home-content">
        <PageHeader
          title={t("mechanic.workorders")}
          actions={(
            <WorkspaceCreateActions
              actor={actor}
              locale={locale}
              onCreateWorkorder={onCreateWorkorder}
              createLabel={t("mechanic.createWorkorder")}
            />
          )}
        />

        {!online ? <p className="workspace-connection-state" role="status">{t("mechanic.offline")}</p> : null}
        <section className="mechanic-queue-shell" aria-label={t("mechanic.work")}>
          <div className="mechanic-primary-queues">
            <div className="mechanic-wide-queues">
              <WorkorderQueueTabs tabs={queueTabs} activeTab={activeTab} onChange={setActiveTab} locale={locale} />
            </div>
            <div className="mechanic-phone-queues">
              <WorkorderQueueTabs tabs={phonePrimaryTabs} activeTab={activeTab} onChange={setActiveTab} locale={locale} />
            </div>
          </div>

          <section className="mechanic-visible-tools" aria-label={t("mechanic.searchFilters")}>
            <label className="mechanic-search">
              <SearchMd aria-hidden="true" />
              <input aria-label={t("mechanic.searchWorkorders")} {...textEntryProps("search")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("mechanic.searchPlaceholder")} />
            </label>
            <div className="mechanic-secondary-actions mechanic-wide-account-actions">
              <LocaleSelector locale={locale} onChange={onLocaleChange} error={localeError} disabled={!localeReady} />
            </div>
          </section>

          {error ? <p className="ops-error" role="alert">{error}</p> : null}

          {loading ? (
            <div className="mechanic-empty-state"><RefreshCw01 className="loading-icon" /><strong>{t("mechanic.loading")}</strong></div>
          ) : nextJob ? (
            <section className="mechanic-next-job" aria-label={t("mechanic.nextJob")}>
              <div className="mechanic-next-job-copy">
                <span className="mechanic-next-job-eyebrow">{t("mechanic.upNext")}</span>
                <h2>{t("mechanic.nextJob")}</h2>
                <strong className="mechanic-next-job-unit">{jobUnit(nextJob, t("queue.noUnit"))}</strong>
                <p>{nextJob.concern || t("mechanic.problemNotRecorded")}</p>
                <span>{jobLocation(nextJob, t("queue.noLocation"))}{nextJob.serial ? ` · ${nextJob.serial}` : ""}</span>
              </div>
              <button
                className="button primary mechanic-next-job-action"
                type="button"
                disabled={openingId === nextJob.id}
                onClick={() => openWorkorder(nextJob.id)}
              >
                {openingId === nextJob.id
                  ? t("mechanic.opening")
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
            <section className="mechanic-assigned-list" aria-label={activeTab === "myWork" ? t("mechanic.otherAssigned") : t("mechanic.workorders")}>
              <div className="mechanic-list-title">
                <h2>{activeTab === "myWork" ? t("mechanic.otherAssigned") : queueTabs.find((tab) => tab.key === activeTab)?.label}</h2>
                <span>{formatLocaleNumber(rows.length, locale)}</span>
              </div>
              <WorkorderTableHeader variant="mechanic" locale={locale} />
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
                        acceptLabel={activeTab === "activeWork" ? t("queue.joinWork") : t("queue.acceptWork")}
                        busyLabel={activeTab === "activeWork" ? t("queue.joining") : t("queue.accepting")}
                        locale={locale}
                        onOpen={() => openWorkorder(workorder.id)}
                        onAccept={() => acceptFromCard(workorder.id)}
                      />
                    )}
                  />
                ) : (
                  <div className="mechanic-empty-state">
                    <strong>{search ? t("mechanic.noMatching") : t("mechanic.noJobsHere")}</strong>
                    {search ? <button type="button" onClick={() => setSearch("")}>{t("mechanic.clearSearch")}</button> : null}
                  </div>
                )}
              </div>
            </section>
          ) : null}

          <details className="mechanic-home-more">
            <summary><span>{t("detail.more")}</span><small>{t("mechanic.moreSummary")}</small></summary>
            <div className="mechanic-home-more-body">
              <div className="mechanic-secondary-queues">
                <WorkorderQueueTabs tabs={phoneSecondaryTabs} activeTab={activeTab} onChange={setActiveTab} locale={locale} />
              </div>
              <section className="mechanic-secondary-tools" aria-label={t("mechanic.accountControls")}>
                <div className="mechanic-secondary-actions">
                  <LocaleSelector locale={locale} onChange={onLocaleChange} error={localeError} disabled={!localeReady} />
                </div>
              </section>
            </div>
          </details>
        </section>
      </div>
    </main>
  );
}
