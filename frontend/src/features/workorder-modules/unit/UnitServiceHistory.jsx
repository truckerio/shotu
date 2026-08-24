import {
  formatServiceHistoryDate,
  serviceHistoryDateLabel,
  serviceHistorySourceLabel,
  serviceHistoryStatus,
  serviceHistorySummaryLabel,
} from "./service-history-model.js";
import { useUnitServiceHistory } from "./useUnitServiceHistory.js";
import "./unit-service-history.css";

function ServiceRecord({ item }) {
  const workPerformed = item.workPerformed || item.serviceLines.join("; ");
  const details = [
    ["Concern", item.concern],
    ["Diagnosis", item.diagnosis],
    ["Work performed", workPerformed],
  ].filter(([, value]) => value);
  return (
    <li className="unit-service-history-record">
      <div className="unit-service-history-record-heading">
        <strong>{serviceHistoryDateLabel(item.dateKind)} · {formatServiceHistoryDate(item.serviceDate)}</strong>
        <span>{item.reference}{item.source ? ` · ${serviceHistorySourceLabel(item.source)}` : ""}</span>
      </div>
      {details.map(([label, value]) => <p key={label}><strong>{label}:</strong> {value}</p>)}
      {item.parts.length ? <p><strong>Parts:</strong> {item.parts.map((part) => `${part.name}${part.quantity !== "" ? ` × ${part.quantity}` : ""}`).join(", ")}</p> : null}
      {Object.values(item.truncated).some(Boolean) ? <p className="unit-service-history-truncated">Some details were shortened. Open the original service order for the complete record.</p> : null}
    </li>
  );
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
          <ol className="unit-service-history-records">{history.items.map((item) => <ServiceRecord key={item.id} item={item} />)}</ol>
          {history.nextCursor ? <button className="unit-service-history-more" type="button" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "Loading…" : "Show more"}</button> : null}
        </> : null}
      </div>
    </details>
  );
}
