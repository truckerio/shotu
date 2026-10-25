import "./collection-count-footer.css";

export function CollectionCountFooter({ label, children, error, onRetry }) {
  return <footer className="checkpoint-collection-footer" aria-label={label}>
    <span role="status">{children}</span>
    {error ? <span className="error" role="alert">{error.message || String(error)} {onRetry ? <button type="button" onClick={onRetry}>Retry</button> : null}</span> : null}
  </footer>;
}
