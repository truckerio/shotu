import "./severity-pill.css";

/** Compact issue summary. The owning workflow supplies severity and full context. */
export function SeverityPill({ severity = "review", label, additionalCount = 0, description = "" }) {
  const tone = ["review", "warning", "error"].includes(severity) ? severity : "review";
  return <span className="severity-pill" data-severity={tone} title={description || undefined}>
    <span>{label}</span>
    {additionalCount > 0 ? <span className="severity-pill-count">+{additionalCount}</span> : null}
  </span>;
}
