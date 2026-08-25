import {
  formatServiceHistoryDate,
  serviceHistoryDateLabel,
  serviceHistorySourceLabel,
  serviceHistoryStatus,
  serviceHistorySummaryLabel,
} from "./service-history-model.js";
import { WorkorderTimelineList } from "../../../components/workorders/WorkorderTimeline.jsx";
import { useUnitServiceHistory } from "./useUnitServiceHistory.js";
import "./unit-service-history.css";

function serviceRecordTimelineItem(item) {
  const workPerformed = item.workPerformed || item.serviceLines.join("; ");
  const details = [
    ["Concern", item.concern],
    ["Diagnosis", item.diagnosis],
    ["Work performed", workPerformed],
    ["Parts", item.parts.map((part) => `${part.name}${part.quantity !== "" ? ` × ${part.quantity}` : ""}`).join(", ")],
  ].filter(([, value]) => value).map(([label, value]) => ({ label, value }));
  return {
    id: item.id,
    actorName: item.reference,
    actorLabel: item.source ? serviceHistorySourceLabel(item.source) : "",
    createdAt: item.serviceDate,
    dateText: formatServiceHistoryDate(item.serviceDate),
    title: `${serviceHistoryDateLabel(item.dateKind)} service`,
    details,
    content: Object.values(item.truncated).some(Boolean)
      ? <p className="workorder-timeline-note">Some details were shortened. Open the original service order for the complete record.</p>
      : null,
  };
}

function UnitServiceHistorySummary({ history, loading }) {
  return (
    <summary className="unit-service-history-summary">
      <span className="unit-service-history-summary-copy">
        <strong>Service history</strong>
        <span>{loading ? "Loading previous service" : serviceHistorySummaryLabel(history)}</span>
        {history?.summary.historyCount ? <span>{history.summary.historyCount} previous service record{history.summary.historyCount === 1 ? "" : "s"}</span> : null}
      </span>
    </summary>
  );
}

export function UnitServiceHistory({ actorRole, historyController, workorderId }) {
  const fallbackController = useUnitServiceHistory({ enabled: Boolean(workorderId) && !historyController, workorderId });
  const { error, expanded, history, loading, loadingMore, reload, loadMore, setExpanded } = historyController || fallbackController;
  const status = serviceHistoryStatus(history);
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
      <UnitServiceHistorySummary history={history} loading={loading} />
      <div className="unit-service-history-content" aria-live="polite">
        {loading ? <p role="status">Loading service history…</p> : null}
        {error ? <div className="unit-service-history-state" role="alert"><strong>Service history is unavailable</strong><span>{error}</span><button type="button" onClick={reload}>Try again</button></div> : null}
        {!loading && !error && showBlockingState ? <div className="unit-service-history-state" role="status"><strong>{status.title}</strong><span>{status.message}</span>{history?.state === "unavailable" ? <button type="button" onClick={reload}>Try again</button> : null}</div> : null}
        {!loading && adminNeedsIntegrationAction ? <a className="unit-service-history-admin-action" href="/?adminView=settings&settingsTab=integrations">Open integration settings</a> : null}
        {!loading && !error && canShowRecords ? <>
          {history.state === "stale" ? <div className="unit-service-history-state is-warning" role="status"><strong>{status.title}</strong><span>{status.message}</span></div> : null}
          {providerNeverSynced ? <div className="unit-service-history-state is-warning" role="status"><strong>Odoo history has not been synced</strong><span>Local completed service records are shown. Ask an admin to check the integration.</span></div> : null}
          <WorkorderTimelineList items={history.items.map(serviceRecordTimelineItem)} emptyMessage="No previous service records." />
          {history.nextCursor ? <button className="unit-service-history-more" type="button" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "Loading…" : "Show more"}</button> : null}
        </> : null}
      </div>
    </details>
  );
}
