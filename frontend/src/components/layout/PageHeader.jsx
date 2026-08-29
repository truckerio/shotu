import "./page-header.css";

export function PageHeader({
  title,
  subtitle = "",
  leading = null,
  actions = null,
  className = "",
}) {
  return (
    <header className={`page-header ${className}`.trim()}>
      {leading ? <div className="page-header-leading">{leading}</div> : null}
      <div className="page-header-heading">
        <div className="page-header-copy">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}
