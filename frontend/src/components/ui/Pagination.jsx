import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "@untitledui/icons";
import "./pagination.css";

export function clampPage(page, pageCount) {
  return Math.min(Math.max(1, Number(page) || 1), Math.max(1, Number(pageCount) || 1));
}

export function usePagination(items, { pageSize = 20, resetKey = "" } = {}) {
  const [page, setPage] = useState(1);
  const total = Array.isArray(items) ? items.length : 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = clampPage(page, pageCount);

  useEffect(() => setPage(1), [resetKey]);
  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);

  const pageItems = useMemo(
    () => (Array.isArray(items) ? items.slice((currentPage - 1) * pageSize, currentPage * pageSize) : []),
    [currentPage, items, pageSize],
  );

  return { currentPage, pageCount, pageItems, setPage, total, loading: false };
}

export function Pagination({ currentPage, pageCount, setPage, total, label = "items", loading = false }) {
  const safePageCount = Math.max(1, Number(pageCount) || 1);
  const safeCurrentPage = clampPage(currentPage, safePageCount);
  if (safePageCount <= 1) return null;
  return (
    <nav className="ui-pagination" aria-label={`${label} pages`} aria-busy={loading || undefined}>
      <button type="button" onClick={() => setPage((page) => clampPage(page - 1, safePageCount))} disabled={loading || safeCurrentPage <= 1}><ChevronLeft />Previous</button>
      <span aria-live="polite"><strong>{safeCurrentPage}</strong> / {safePageCount}<small>{total} {label}</small></span>
      <button type="button" onClick={() => setPage((page) => clampPage(page + 1, safePageCount))} disabled={loading || safeCurrentPage >= safePageCount}>Next<ChevronRight /></button>
    </nav>
  );
}
