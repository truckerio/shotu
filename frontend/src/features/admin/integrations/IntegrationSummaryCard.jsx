import { Button } from "../../../components/ui/Button.jsx";

export function IntegrationSummaryCard({
  icon: Icon,
  title,
  statusLabel,
  statusTone = "disconnected",
  facts = [],
  onManage,
}) {
  return (
    <article className="integration-card integration-summary-card">
      <header className="integration-card-header">
        <span className="integration-provider-icon"><Icon /></span>
        <div><h2>{title}</h2></div>
        {statusLabel ? <span className={`integration-status ${statusTone}`}>{statusLabel}</span> : null}
      </header>
      {facts.length ? <dl className="integration-summary-facts">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl> : null}
      <footer className="integration-card-actions">
        <Button onClick={onManage}>Manage</Button>
      </footer>
    </article>
  );
}
