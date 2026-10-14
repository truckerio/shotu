import { useEffect, useMemo, useState } from "react";

export function clientCheckpointWindow(first, last, pageCount, maxPages = 5) {
  const end = Math.min(Math.max(1, pageCount), Math.max(1, last));
  return { first: Math.min(end, Math.max(1, first, end - maxPages + 1)), last: end };
}

export function clientCheckpointBatches(items, window, pageSize) {
  return Array.from({ length: window.last - window.first + 1 }, (_, index) => {
    const page = window.first + index;
    return { page, items: (items || []).slice((page - 1) * pageSize, page * pageSize) };
  });
}

// Source arrays remain authoritative: edits/removals never leave cached objects
// behind. Only the mounted batch window is retained between renders.
export function useClientCheckpointPages(items, { pageSize = 20, resetKey = "", maxPages = 5, initialPage = 1 } = {}) {
  const total = Array.isArray(items) ? items.length : 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const [state, setState] = useState(() => ({ key: resetKey, first: initialPage, last: initialPage, revision: 0 }));
  const reset = !Object.is(state.key, resetKey);
  const window = clientCheckpointWindow(reset ? 1 : state.first, reset ? 1 : state.last, pageCount, maxPages);
  useEffect(() => {
    setState((current) => {
      if (!Object.is(current.key, resetKey)) return { key: resetKey, first: 1, last: 1, revision: current.revision + 1 };
      const next = clientCheckpointWindow(current.first, current.last, pageCount, maxPages);
      return next.first === current.first && next.last === current.last ? current : { ...current, ...next };
    });
  }, [resetKey, pageCount, maxPages]);
  const pages = useMemo(() => clientCheckpointBatches(items, window, pageSize), [items, window.first, window.last, pageSize]);
  function move(direction, target) {
    setState((current) => {
      const active = Object.is(current.key, resetKey) ? clientCheckpointWindow(current.first, current.last, pageCount, maxPages) : { first: 1, last: 1 };
      if (direction === "jump") {
        const page = Math.min(pageCount, Math.max(1, Number(target) || 1));
        return { key: resetKey, first: page, last: page, revision: current.revision + 1 };
      }
      if (direction === "next") {
        const last = Math.min(pageCount, active.last + 1);
        if (last === active.last && Object.is(current.key, resetKey)) return current;
        return { ...current, key: resetKey, first: Math.max(active.first, last - maxPages + 1), last };
      }
      const first = Math.max(1, active.first - 1);
      if (first === active.first && Object.is(current.key, resetKey)) return current;
      return { ...current, key: resetKey, first, last: Math.min(active.last, first + maxPages - 1) };
    });
    return Promise.resolve(true);
  }
  return {
    pages, total, pageCount, loading: false, loadingMore: false, error: null,
    jumpRevision: state.revision + (reset ? 1 : 0),
    loadNext: () => move("next"), loadPrevious: () => move("previous"),
    jumpTo: (page) => move("jump", page), retry: () => Promise.resolve(true), refresh: () => Promise.resolve(true),
  };
}
