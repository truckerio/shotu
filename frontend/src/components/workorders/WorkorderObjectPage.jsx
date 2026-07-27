import { useId } from "react";
import { ChevronDown } from "@untitledui/icons";

function compactValue(value, fallback = "Not listed") {
  const text = String(value || "").trim();
  return text || fallback;
}

export function WorkorderObjectSummary({
  concern,
  customer,
  dates,
  location,
  mechanics,
  unit,
  unitType = "Unit",
  actions,
  children,
}) {
  const headingId = useId();

  return (
    <section className="workorder-object-summary" aria-labelledby={headingId}>
      <div className="workorder-object-primary">
        <span>Work to do</span>
        <h1 id={headingId}>{compactValue(concern, "No repair concern listed")}</h1>
      </div>
      <dl className="workorder-object-facts">
        <div>
          <dt>{compactValue(unitType, "Unit")}</dt>
          <dd>{compactValue(unit)}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{compactValue(location)}</dd>
        </div>
        <div>
          <dt>Mechanics</dt>
          <dd>{compactValue(mechanics, "Unassigned")}</dd>
        </div>
        <div>
          <dt>Customer</dt>
          <dd>{compactValue(customer)}</dd>
        </div>
        <div>
          <dt>Work dates</dt>
          <dd>{compactValue(dates)}</dd>
        </div>
      </dl>
      {children}
      {actions ? <div className="workorder-object-actions" aria-label="Workorder actions">{actions}</div> : null}
    </section>
  );
}

export function WorkorderSectionNav({ sections, activeSection, onSelect }) {
  return (
    <nav className="workorder-section-nav" aria-label="Workorder sections">
      {sections.map(({ id, label, count, attention }) => (
        <button
          className={`${activeSection === id ? "is-active" : ""} ${attention ? "has-attention" : ""}`.trim()}
          type="button"
          key={id}
          aria-current={activeSection === id ? "page" : undefined}
          onClick={() => onSelect(id)}
        >
          <span>{label}</span>
          {count !== undefined && count !== null ? <small>{count}</small> : null}
        </button>
      ))}
    </nav>
  );
}

export function ProgressiveWorkorderSection({
  id,
  title,
  summary,
  activeSection,
  onSelect,
  attention = false,
  children,
  className = "",
  displayMode = "accordion",
}) {
  const panelId = useId();
  const open = activeSection === id;

  if (displayMode === "panel") {
    if (!open) return null;
    return (
      <section
        className={`workorder-section-panel ${attention ? "has-attention" : ""} ${className}`.trim()}
        id={panelId}
        role="tabpanel"
        aria-label={title}
      >
        <div className="workorder-section-panel-heading">
          <div>
            <h2>{title}</h2>
            {summary ? <p>{summary}</p> : null}
          </div>
        </div>
        <div className="workorder-section-panel-content">
          {children}
        </div>
      </section>
    );
  }

  return (
    <section className={`workorder-progressive-section ${open ? "is-open" : ""} ${attention ? "has-attention" : ""} ${className}`.trim()}>
      <button
        className="workorder-progressive-trigger"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onSelect(open ? "" : id)}
      >
        <span className="workorder-progressive-label">{title}</span>
        <small>{summary}</small>
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div className="workorder-progressive-content" id={panelId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
