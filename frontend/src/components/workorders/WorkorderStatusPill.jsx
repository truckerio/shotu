export function WorkorderStatusPill({ status, label }) {
  return <span className={`ops-status status-${status}`}>{label || status}</span>;
}
