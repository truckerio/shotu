const DEFAULT_MAX_PAGES = 5;
const DEFAULT_MAX_CACHE_PAGES = 9;

function asPositiveInteger(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function asCount(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function itemKey(item) {
  return item?.id == null ? null : String(item.id);
}

function uniqueItems(items, seen = new Set(), getItemKey = itemKey) {
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const identity = getItemKey(item);
    const key = identity == null ? null : String(identity);
    if (key !== null) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    result.push(item);
  }
  return result;
}

function normalizeResponse(response, requestedPage) {
  const pageCount = asCount(response?.pageCount);
  const upperBound = Math.max(1, pageCount);
  const responsePage = asPositiveInteger(response?.page, requestedPage);
  return {
    page: Math.min(responsePage, upperBound),
    items: Array.isArray(response?.items) ? response.items : [],
    total: asCount(response?.total),
    pageCount,
    meta: response?.meta,
  };
}

export function createEmptyCheckpointPagesSnapshot({ loading = false, jumpRevision = 0 } = {}) {
  return Object.freeze({
    pages: Object.freeze([]),
    total: 0,
    pageCount: 0,
    loading,
    loadingMore: false,
    error: null,
    failedDirection: null,
    jumpRevision,
  });
}

export function createCheckpointPagesController({
  fetchPage,
  enabled = true,
  initialPage = 1,
  maxPages = DEFAULT_MAX_PAGES,
  maxCachePages = DEFAULT_MAX_CACHE_PAGES,
  initialJumpRevision = 0,
  getItemKey = itemKey,
} = {}) {
  if (typeof fetchPage !== "function") throw new TypeError("fetchPage must be a function.");

  const visibleLimit = asPositiveInteger(maxPages, DEFAULT_MAX_PAGES);
  const cacheLimit = Math.max(visibleLimit, asPositiveInteger(maxCachePages, DEFAULT_MAX_CACHE_PAGES));
  const cache = new Map();
  const activeRequests = new Map();
  const listeners = new Set();
  let visiblePages = [];
  let generation = 0;
  let touchRevision = 0;
  let stopped = false;
  let started = false;
  let lastFailedAction = null;
  let state = {
    total: 0,
    pageCount: 0,
    loading: false,
    loadingMore: false,
    error: null,
    failedDirection: null,
    jumpRevision: asCount(initialJumpRevision),
  };
  let snapshot = createEmptyCheckpointPagesSnapshot({ jumpRevision: state.jumpRevision });

  const publish = () => {
    const seen = new Set();
    const pages = visiblePages
      .slice()
      .sort((left, right) => left - right)
      .map((page) => ({ page, items: uniqueItems(cache.get(page)?.items, seen, getItemKey), ...(cache.get(page)?.meta === undefined ? {} : { meta: cache.get(page).meta }) }));
    snapshot = Object.freeze({
      pages: Object.freeze(pages),
      total: state.total,
      pageCount: state.pageCount,
      loading: state.loading,
      loadingMore: state.loadingMore,
      error: state.error,
      failedDirection: state.failedDirection,
      jumpRevision: state.jumpRevision,
    });
    for (const listener of listeners) listener();
  };

  const abortRequests = () => {
    for (const request of activeRequests.values()) request.controller.abort();
    activeRequests.clear();
  };

  const beginGeneration = () => {
    generation += 1;
    abortRequests();
    return generation;
  };

  const touch = (page) => {
    const entry = cache.get(page);
    if (entry) entry.touched = ++touchRevision;
  };

  const pruneCache = () => {
    const visible = new Set(visiblePages);
    while (cache.size > cacheLimit) {
      const candidate = [...cache.entries()]
        .filter(([page]) => !visible.has(page))
        .sort((left, right) => left[1].touched - right[1].touched)[0];
      if (!candidate) return;
      cache.delete(candidate[0]);
    }
  };

  const storePage = (pageData) => {
    cache.set(pageData.page, { ...pageData, touched: ++touchRevision });
    state.total = pageData.total;
    state.pageCount = pageData.pageCount;
  };

  const isCacheValid = (page) => {
    if (!cache.has(page)) return false;
    return state.pageCount === 0 ? page === 1 : page <= state.pageCount;
  };

  const fetchRaw = (page, requestGeneration) => {
    const active = activeRequests.get(page);
    if (active && active.generation === requestGeneration) return active.promise;

    const controller = new AbortController();
    const request = { controller, generation: requestGeneration, promise: null };
    request.promise = Promise.resolve()
      .then(() => fetchPage(page, { signal: controller.signal }))
      .then((response) => {
        if (stopped || controller.signal.aborted || requestGeneration !== generation) return null;
        return normalizeResponse(response, page);
      })
      .catch((error) => {
        if (stopped || controller.signal.aborted || requestGeneration !== generation) return null;
        throw error;
      })
      .finally(() => {
        if (activeRequests.get(page) === request) activeRequests.delete(page);
      });
    activeRequests.set(page, request);
    return request.promise;
  };

  const fetchWithClamp = async (requestedPage, requestGeneration) => {
    const first = await fetchRaw(requestedPage, requestGeneration);
    if (!first) return null;
    if (requestedPage > 1 && first.pageCount === 0 && first.items.length === 0) {
      const firstPage = await fetchRaw(1, requestGeneration);
      if (!firstPage) return null;
      const discoveredLastPage = Math.max(1, firstPage.pageCount);
      if (discoveredLastPage > 1) return fetchRaw(discoveredLastPage, requestGeneration);
      return firstPage;
    }
    const lastValidPage = Math.max(1, first.pageCount);
    if (requestedPage > lastValidPage && first.items.length === 0) {
      return fetchRaw(lastValidPage, requestGeneration);
    }
    return first;
  };

  const trimVisible = (direction) => {
    visiblePages = [...new Set(visiblePages)].sort((left, right) => left - right);
    while (visiblePages.length > visibleLimit) {
      if (direction === "previous") visiblePages.pop();
      else visiblePages.shift();
    }
  };

  const removeOutOfRangePages = () => {
    if (state.pageCount <= 0) {
      for (const page of [...cache.keys()]) if (page > 1) cache.delete(page);
      visiblePages = visiblePages.filter((page) => page === 1);
      return;
    }
    for (const page of [...cache.keys()]) if (page > state.pageCount) cache.delete(page);
    visiblePages = visiblePages.filter((page) => page <= state.pageCount);
  };

  const setFailure = (error, direction, retry) => {
    state.loading = false;
    state.loadingMore = false;
    state.error = error instanceof Error ? error : new Error(String(error));
    state.failedDirection = direction;
    lastFailedAction = retry;
    publish();
  };

  const loadTarget = async (targetPage, { direction, replace = false, jump = false } = {}) => {
    if (stopped || !enabled) return false;
    const requestedPage = asPositiveInteger(targetPage);
    const clampedPage = state.pageCount > 0 ? Math.min(requestedPage, state.pageCount) : requestedPage;
    const retry = () => loadTarget(requestedPage, { direction, replace, jump });

    if (jump) {
      beginGeneration();
      state.loading = false;
      state.loadingMore = false;
    }
    const requestGeneration = generation;
    state.error = null;
    state.failedDirection = null;
    lastFailedAction = null;

    if (isCacheValid(clampedPage)) {
      touch(clampedPage);
      visiblePages = replace ? [clampedPage] : [...visiblePages, clampedPage];
      trimVisible(direction);
      state.loading = false;
      state.loadingMore = false;
      if (jump) state.jumpRevision += 1;
      publish();
      return true;
    }

    if (replace) state.loading = true;
    else state.loadingMore = true;
    publish();
    try {
      const pageData = await fetchWithClamp(clampedPage, requestGeneration);
      if (!pageData || stopped || requestGeneration !== generation) return false;
      if (state.pageCount > 0 && pageData.pageCount < state.pageCount) {
        cache.clear();
        visiblePages = [];
      }
      storePage(pageData);
      removeOutOfRangePages();
      visiblePages = replace ? [pageData.page] : [...visiblePages, pageData.page];
      trimVisible(direction);
      pruneCache();
      state.loading = false;
      state.loadingMore = false;
      if (jump) state.jumpRevision += 1;
      publish();
      return true;
    } catch (error) {
      if (stopped || requestGeneration !== generation) return false;
      setFailure(error, direction, retry);
      return false;
    }
  };

  const start = () => {
    if (started || stopped || !enabled) return Promise.resolve(false);
    started = true;
    return loadTarget(initialPage, { direction: "initial", replace: true });
  };

  const loadNext = () => {
    if (state.loading || state.loadingMore || visiblePages.length === 0) return Promise.resolve(false);
    const target = Math.max(...visiblePages) + 1;
    if (target > state.pageCount) return Promise.resolve(false);
    return loadTarget(target, { direction: "next" });
  };

  const loadPrevious = () => {
    if (state.loading || state.loadingMore || visiblePages.length === 0) return Promise.resolve(false);
    const target = Math.min(...visiblePages) - 1;
    if (target < 1) return Promise.resolve(false);
    return loadTarget(target, { direction: "previous" });
  };

  const jumpTo = (page) => loadTarget(page, { direction: "jump", replace: true, jump: true });

  const refresh = async () => {
    if (stopped || !enabled) return false;
    if (state.loading || state.loadingMore) return false;
    const pagesToRefresh = visiblePages.slice().sort((left, right) => left - right);
    if (pagesToRefresh.length === 0) return start();
    const retry = () => refresh();
    const requestGeneration = beginGeneration();
    state.loadingMore = true;
    state.error = null;
    state.failedDirection = null;
    lastFailedAction = null;
    publish();
    try {
      const responses = await Promise.all(
        pagesToRefresh.map((page) => fetchWithClamp(page, requestGeneration)),
      );
      if (stopped || requestGeneration !== generation || responses.some((response) => !response)) return false;

      const byPage = new Map();
      for (const response of responses) byPage.set(response.page, response);
      const freshEntries = [...byPage.values()].sort((left, right) => left.page - right.page);
      // Server order is authoritative; the table preserves the measured row anchor.
      const reconciled = freshEntries;
      const refreshedPages = new Set(reconciled.map((entry) => entry.page));
      for (const page of [...cache.keys()]) if (!refreshedPages.has(page)) cache.delete(page);
      for (const entry of reconciled) storePage(entry);
      removeOutOfRangePages();
      if (visiblePages.length === 0 && reconciled.length > 0) {
        visiblePages = [reconciled[reconciled.length - 1].page];
      }
      trimVisible("next");
      pruneCache();
      state.loading = false;
      state.loadingMore = false;
      publish();
      return true;
    } catch (error) {
      if (stopped || requestGeneration !== generation) return false;
      setFailure(error, "refresh", retry);
      return false;
    }
  };

  const retry = () => lastFailedAction?.() ?? Promise.resolve(false);

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    loadNext,
    loadPrevious,
    jumpTo,
    retry,
    refresh,
    stop() {
      if (stopped) return;
      stopped = true;
      beginGeneration();
      listeners.clear();
    },
  };
}
