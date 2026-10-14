import { useCallback, useEffect, useRef, useState } from "react";
import {
  createCheckpointPagesController,
  createEmptyCheckpointPagesSnapshot,
} from "./checkpoint-pages.js";

function sameSession(left, right) {
  return Boolean(left && right)
    && Object.is(left.queryKey, right.queryKey)
    && left.enabled === right.enabled
    && left.initialPage === right.initialPage
    && left.maxPages === right.maxPages;
}

export function useCheckpointPages({
  queryKey,
  fetchPage,
  enabled = true,
  refreshKey,
  initialPage = 1,
  maxPages = 5,
  getItemKey,
}) {
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;
  const itemKeyRef = useRef(getItemKey);
  itemKeyRef.current = getItemKey;
  const desiredSession = { queryKey, enabled, initialPage, maxPages };
  const desiredSessionRef = useRef(desiredSession);
  desiredSessionRef.current = desiredSession;
  const controllerRef = useRef(null);
  const controllerSessionRef = useRef(null);
  const resetRevisionRef = useRef(0);
  const previousDesiredRef = useRef(desiredSession);
  const refreshKeyRef = useRef(refreshKey);
  const [published, setPublished] = useState(() => ({
    session: desiredSession,
    snapshot: createEmptyCheckpointPagesSnapshot({ loading: enabled }),
  }));

  const sessionChanged = !sameSession(previousDesiredRef.current, desiredSession);
  if (sessionChanged) {
    previousDesiredRef.current = desiredSession;
    resetRevisionRef.current += 1;
  }

  useEffect(() => {
    const session = { queryKey, enabled, initialPage, maxPages };
    const controller = createCheckpointPagesController({
      fetchPage: (...args) => fetchPageRef.current(...args),
      enabled,
      initialPage,
      maxPages,
      getItemKey: (item) => itemKeyRef.current ? itemKeyRef.current(item) : item.id,
      initialJumpRevision: resetRevisionRef.current,
    });
    controllerRef.current = controller;
    controllerSessionRef.current = session;
    setPublished({ session, snapshot: controller.getSnapshot() });
    const unsubscribe = controller.subscribe(() => {
      setPublished({ session, snapshot: controller.getSnapshot() });
    });
    void controller.start();
    return () => {
      unsubscribe();
      controller.stop();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        controllerSessionRef.current = null;
      }
    };
  }, [queryKey, enabled, initialPage, maxPages]);

  useEffect(() => {
    const previousRefreshKey = refreshKeyRef.current;
    refreshKeyRef.current = refreshKey;
    if (Object.is(previousRefreshKey, refreshKey)) return;
    if (!sameSession(controllerSessionRef.current, desiredSessionRef.current)) return;
    void controllerRef.current?.refresh();
  }, [refreshKey]);

  const call = useCallback((method, ...args) => {
    if (!sameSession(controllerSessionRef.current, desiredSessionRef.current)) {
      return Promise.resolve(false);
    }
    return controllerRef.current?.[method](...args) ?? Promise.resolve(false);
  }, []);

  const currentSnapshot = sameSession(published.session, desiredSession)
    ? published.snapshot
    : createEmptyCheckpointPagesSnapshot({
      loading: enabled,
      jumpRevision: resetRevisionRef.current,
    });

  return {
    ...currentSnapshot,
    loadNext: useCallback(() => call("loadNext"), [call]),
    loadPrevious: useCallback(() => call("loadPrevious"), [call]),
    jumpTo: useCallback((page) => call("jumpTo", page), [call]),
    retry: useCallback(() => call("retry"), [call]),
    refresh: useCallback(() => call("refresh"), [call]),
  };
}

export default useCheckpointPages;
