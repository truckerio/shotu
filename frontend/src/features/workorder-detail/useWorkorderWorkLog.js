import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeWorkLogView, workLogRequestError } from "./workorder-work-log-model.js";

export function useWorkorderWorkLog({ request, syncToken = "", workorderId }) {
  const generationRef = useRef(0);
  const controllerRef = useRef(null);
  const mutationInFlightRef = useRef(false);
  const [state, setState] = useState({ busy: false, error: "", ready: false, view: null });

  const load = useCallback(async () => {
    if (!request || !workorderId || mutationInFlightRef.current) return null;
    const generation = ++generationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      const result = await request(`/api/workorders/${encodeURIComponent(workorderId)}/work-log`, { signal: controller.signal });
      if (generation !== generationRef.current || controller.signal.aborted) return null;
      const view = normalizeWorkLogView(result);
      setState({ busy: false, error: "", ready: true, view });
      return view;
    } catch (error) {
      if (generation !== generationRef.current || controller.signal.aborted) return null;
      setState((current) => ({ ...current, busy: false, error: workLogRequestError(error), ready: true }));
      return null;
    }
  }, [request, workorderId]);

  useEffect(() => {
    setState({ busy: false, error: "", ready: false, view: null });
    void load();
    return () => {
      generationRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [load, syncToken]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible" && !mutationInFlightRef.current) void load();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);

  const mutate = useCallback(async (path, options) => {
    if (!request || !workorderId) return null;
    const generation = generationRef.current;
    mutationInFlightRef.current = true;
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      const result = await request(`/api/workorders/${encodeURIComponent(workorderId)}/work-log${path}`, options);
      if (generation !== generationRef.current) return null;
      const view = normalizeWorkLogView(result);
      setState({ busy: false, error: "", ready: true, view });
      return view;
    } catch (error) {
      if (generation !== generationRef.current) return null;
      setState((current) => ({ ...current, busy: false, error: workLogRequestError(error), ready: true }));
      throw error;
    } finally {
      mutationInFlightRef.current = false;
    }
  }, [request, workorderId]);

  const changeStatus = useCallback((status) => mutate("", {
    method: "PATCH",
    body: JSON.stringify({ status, expectedVersion: state.view?.version }),
  }), [mutate, state.view?.version]);

  const addLabor = useCallback((entry) => mutate("/labor", {
    method: "POST",
    body: JSON.stringify(entry),
  }), [mutate]);

  const editLabor = useCallback((entryId, entry) => mutate(`/labor/${encodeURIComponent(entryId)}`, {
    method: "PATCH",
    body: JSON.stringify(entry),
  }), [mutate]);

  return { ...state, addLabor, changeStatus, editLabor, refresh: load };
}
