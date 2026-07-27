import { useEffect, useRef } from "react";

export const WORKORDER_DETAIL_REFRESH_MS = 3000;

export function shouldRefreshWorkorderDetail({ enabled, workorderId, paused, documentHidden }) {
  return Boolean(enabled && workorderId && !paused && !documentHidden);
}

export function useWorkorderDetailRealtime({
  enabled,
  workorderId,
  paused = false,
  intervalMs = WORKORDER_DETAIL_REFRESH_MS,
  onRefresh,
}) {
  const refreshRef = useRef(onRefresh);
  const pausedRef = useRef(paused);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (!enabled || !workorderId) return undefined;

    const refresh = () => {
      if (!shouldRefreshWorkorderDetail({
        enabled: true,
        workorderId,
        paused: pausedRef.current,
        documentHidden: document.hidden,
      })) return;
      Promise.resolve(refreshRef.current?.()).catch(() => {});
    };

    const timer = window.setInterval(refresh, intervalMs);
    const refreshOnVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", refreshOnVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [enabled, intervalMs, workorderId]);
}
