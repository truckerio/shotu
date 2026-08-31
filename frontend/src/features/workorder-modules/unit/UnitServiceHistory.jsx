import {
  formatServiceHistoryDate,
  serviceHistoryDateLabel,
  serviceHistorySourceLabel,
  serviceHistoryStatus,
  serviceHistorySummaryLabel,
} from "./service-history-model.js";
import { WorkorderTimelineList } from "../../../components/workorders/WorkorderTimeline.jsx";
import { useUnitServiceHistory } from "./useUnitServiceHistory.js";
import { formatLocaleNumber, interfaceText } from "../../../i18n/index.js";
import "./unit-service-history.css";

function serviceRecordTimelineItem(item, locale) {
  const t = (key) => interfaceText(locale, key);
  const workPerformed = item.workPerformed || item.serviceLines.join("; ");
  const details = [
    [t("detail.concern"), item.concern],
    [t("detail.diagnosis"), item.diagnosis],
    [t("detail.workPerformed"), workPerformed],
    [t("detail.parts"), item.parts.map((part) => `${part.name || t("history.part")}${part.quantity !== "" ? ` × ${part.quantity}` : ""}`).join(", ")],
  ].filter(([, value]) => value).map(([label, value]) => ({ label, value }));
  return {
    id: item.id,
    actorName: item.reference || t("history.serviceRecord"),
    actorLabel: item.source ? serviceHistorySourceLabel(item.source, locale) : "",
    createdAt: item.serviceDate,
    dateText: formatServiceHistoryDate(item.serviceDate, locale),
    title: `${serviceHistoryDateLabel(item.dateKind, locale)} ${t("history.service")}`,
    details,
    content: Object.values(item.truncated).some(Boolean)
      ? <p className="workorder-timeline-note">{t("history.detailsShortened")}</p>
      : null,
  };
}

function UnitServiceHistorySummary({ history, loading, locale }) {
  const t = (key) => interfaceText(locale, key);
  return (
    <summary className="unit-service-history-summary">
      <span className="unit-service-history-summary-copy">
        <strong>{t("history.title")}</strong>
        <span>{loading ? t("history.loadingPrevious") : serviceHistorySummaryLabel(history, locale)}</span>
        {history?.summary.historyCount ? <span>{formatLocaleNumber(history.summary.historyCount, locale)} {t(history.summary.historyCount === 1 ? "history.previousRecord" : "history.previousRecords")}</span> : null}
      </span>
    </summary>
  );
}

export function UnitServiceHistory({ actorRole, historyController, workorderId, locale = "en" }) {
  const t = (key) => interfaceText(locale, key);
  const fallbackController = useUnitServiceHistory({ enabled: Boolean(workorderId) && !historyController, locale, workorderId });
  const { error, expanded, history, loading, loadingMore, reload, loadMore, setExpanded } = historyController || fallbackController;
  const status = serviceHistoryStatus(history, locale, { includeDiagnostic: actorRole !== "mechanic" });
  const canShowRecords = history?.items.length && history.state !== "unavailable";
  const showBlockingState = history?.state !== "ready" && !(history?.state === "stale" && canShowRecords);
  const providerNeverSynced = history?.state === "ready" && history.freshness.state === "never_synced";
  const adminNeedsIntegrationAction = actorRole === "admin"
    && (error || ["unlinked", "never_synced", "stale", "unavailable"].includes(history?.state));

  return (
    <details
      className="unit-service-history"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <UnitServiceHistorySummary history={history} loading={loading} locale={locale} />
      <div className="unit-service-history-content" aria-live="polite">
        {loading ? <p role="status">{t("history.loading")}</p> : null}
        {error ? <div className="unit-service-history-state" role="alert"><strong>{t("history.unavailable")}</strong><span>{actorRole === "mechanic" ? t("history.loadFailed") : error}</span><button type="button" onClick={reload}>{t("history.tryAgain")}</button></div> : null}
        {!loading && !error && showBlockingState ? <div className="unit-service-history-state" role="status"><strong>{status.title}</strong><span>{status.message}</span>{history?.state === "unavailable" ? <button type="button" onClick={reload}>{t("history.tryAgain")}</button> : null}</div> : null}
        {!loading && adminNeedsIntegrationAction ? <a className="unit-service-history-admin-action" href="/?adminView=settings&settingsTab=integrations">{t("history.openSettings")}</a> : null}
        {!loading && !error && canShowRecords ? <>
          {history.state === "stale" ? <div className="unit-service-history-state is-warning" role="status"><strong>{status.title}</strong><span>{status.message}</span></div> : null}
          {providerNeverSynced ? <div className="unit-service-history-state is-warning" role="status"><strong>{t("history.odooNotSynced")}</strong><span>{t("history.localShown")}</span></div> : null}
          <WorkorderTimelineList className="is-service-history" items={history.items.map((item) => serviceRecordTimelineItem(item, locale))} emptyMessage={t("history.noPreviousRecords")} locale={locale} />
          {history.nextCursor ? <button className="unit-service-history-more" type="button" onClick={loadMore} disabled={loadingMore}>{loadingMore ? t("history.loadingMore") : t("history.showMore")}</button> : null}
        </> : null}
      </div>
    </details>
  );
}
