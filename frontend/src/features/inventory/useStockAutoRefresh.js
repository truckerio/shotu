import { useEffect, useRef } from "react";
import { startStockAutoRefresh } from "./stock-auto-refresh.js";

export function useStockAutoRefresh({ enabled, sessionKey, refresh, canRefresh }) {
  const current = useRef({ refresh, canRefresh });
  current.current = { refresh, canRefresh };
  const controller = useRef(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const stop = startStockAutoRefresh({
      refresh: (options) => current.current.refresh(options),
      canRefresh: () => current.current.canRefresh(),
    });
    controller.current = stop;
    return () => { stop(); controller.current = null; };
  }, [enabled, sessionKey]);
  // Flush a queued event when an editor closes or its initial read finishes.
  useEffect(() => { void controller.current?.check(); });
}
