import { PageHeader } from "../layout/PageHeader.jsx";
import "./operational-collection-page.css";

function joinClasses(...values) {
  return values.filter(Boolean).join(" ");
}

export function OperationalCollectionPage({
  title,
  subtitle = "",
  leading = null,
  actions = null,
  presentation = "page",
  className = "",
  children,
}) {
  const embedded = presentation === "embedded";

  return (
    <section className={joinClasses("operational-collection-page", `is-${presentation}`, className)}>
      <PageHeader title={title} subtitle={subtitle} leading={leading} actions={actions} headingLevel={embedded ? 2 : 1} />
      <div className="operational-collection-page-body">{children}</div>
    </section>
  );
}

export function OperationalCollectionTabs({ items, activeId, onChange, ariaLabel, className = "" }) {
  return (
    <div className={joinClasses("operational-collection-tabs-wrap", className)}>
      <div className="operational-collection-tabs" role="group" aria-label={ariaLabel}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={activeId === item.id}
            className={activeId === item.id ? "active" : ""}
            onClick={() => onChange(item.id)}
          >
            <span>{item.label}</span>
            {item.count !== undefined ? <strong aria-label={item.countLabel}>{item.count}</strong> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function OperationalCollectionToolbar({ children, className = "" }) {
  return <div className={joinClasses("operational-collection-toolbar", className)}>{children}</div>;
}

export function OperationalCollectionResultHeader({ children, className = "", ...props }) {
  return <div {...props} className={joinClasses("operational-collection-result-header", className)}>{children}</div>;
}

export function OperationalCollectionTable({ columns, children, ariaLabel, busy = false, className = "" }) {
  return (
    <div
      className={joinClasses("operational-collection-table", className)}
      role="table"
      aria-label={ariaLabel}
      aria-busy={busy}
    >
      <div className="operational-collection-table-head" role="row">
        {columns.map((column) => (
          <span className={column.className || undefined} role="columnheader" key={column.id}>{column.label}</span>
        ))}
      </div>
      {children}
    </div>
  );
}

export function OperationalCollectionRow({ children, className = "", ariaLabel, onAction, ...props }) {
  function activate(event) {
    if (!onAction || (event.type === "keydown" && !["Enter", " "].includes(event.key))) return;
    if (event.target !== event.currentTarget && event.target.closest?.("button, a, input, select, textarea, [role='button'], [role='link']")) return;
    if (event.type === "keydown") event.preventDefault();
    onAction();
  }

  return (
    <div
      {...props}
      className={joinClasses("operational-collection-row", className, onAction ? "is-interactive" : "")}
      role="row"
      tabIndex={onAction ? 0 : undefined}
      aria-label={ariaLabel}
      onClick={onAction ? activate : undefined}
      onKeyDown={onAction ? activate : undefined}
    >
      {children}
    </div>
  );
}

export function OperationalCollectionCell({ children, label, className = "" }) {
  return <div className={joinClasses("operational-collection-cell", className)} role="cell" data-label={label}>{children}</div>;
}
