import { CheckpointRail } from "./CheckpointRail.jsx";
import { clampPage } from "./Pagination.jsx";
import "./collection-pagination.css";

// Controlled pagination presentation only: each collection retains its own data,
// filters and loading lifecycle. Cursor-only lists must not use exact batch jumps.
export function CollectionPagination({
  currentPage, pageCount, setPage, total, label = "items", pageSize = 20,
  loading = false, children, className = "", enabled = true,
}) {
  const count = Math.max(1, Math.floor(Number(pageCount) || 1));
  const page = clampPage(currentPage, count);
  const showRail = count > 1;
  if (!enabled) return children;

  return <div className={`collection-pagination${showRail ? " has-rail" : ""} ${className}`.trim()} aria-busy={loading || undefined}>
    {showRail ? <div className="collection-pagination-rail"><CheckpointRail currentPage={page} pageCount={count} total={total} pageSize={pageSize}
      label={label} disabled={loading} onJump={(next) => setPage(clampPage(next, count))} /></div> : null}
    <div className="collection-pagination-content">{children}</div>
    {showRail ? <span className="collection-pagination-status" role="status">Batch {page} of {count} · {total} {label}</span> : null}
  </div>;
}
