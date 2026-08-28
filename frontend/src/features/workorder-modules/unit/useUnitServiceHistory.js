import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api.js";
import { interfaceText } from "../../../i18n/index.js";
import { normalizeServiceHistoryResponse } from "./service-history-model.js";

function endpoint(workorderId, cursor = "") {
  const params = new URLSearchParams({ limit: "10" });
  if (cursor) params.set("cursor", cursor);
  return `/api/workorders/${encodeURIComponent(workorderId)}/modules/unit/history?${params}`;
}

export function useUnitServiceHistory({ enabled, workorderId, locale = "en" }) {
  const requestSequence = useRef(0);
  const controllerRef = useRef(null);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async ({ cursor = "", append = false } = {}) => {
    if (!enabled || !workorderId) return null;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = ++requestSequence.current;
    setError("");
    append ? setLoadingMore(true) : setLoading(true);
    try {
      const response = normalizeServiceHistoryResponse(await api(endpoint(workorderId, cursor), { signal: controller.signal, timeoutMs: 12000 }));
      if (request !== requestSequence.current) return null;
      setHistory((current) => append && current ? { ...response, items: [...current.items, ...response.items] } : response);
      return response;
    } catch (cause) {
      if (controller.signal.aborted || request !== requestSequence.current) return null;
      setError(locale === "en" && cause?.message
        ? cause.message
        : interfaceText(locale, "history.loadFailed"));
      return null;
    } finally {
      if (request === requestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [enabled, locale, workorderId]);

  useEffect(() => {
    setHistory(null);
    setError("");
    setExpanded(false);
    if (enabled && workorderId) load();
    return () => controllerRef.current?.abort();
  }, [enabled, load, workorderId]);

  return {
    error,
    expanded,
    history,
    loading,
    loadingMore,
    reload: () => load(),
    loadMore: () => history?.nextCursor ? load({ cursor: history.nextCursor, append: true }) : null,
    setExpanded,
  };
}
