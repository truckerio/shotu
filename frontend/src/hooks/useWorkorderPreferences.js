import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";

const EMPTY_PREFERENCES = {
  defaultLocationId: null,
  defaultView: "all",
  pageSize: 50,
  savedFilters: {},
};

export function useWorkorderPreferences(scope) {
  const [preferences, setPreferences] = useState(EMPTY_PREFERENCES);
  const [ready, setReady] = useState(false);
  const saveTimer = useRef(null);
  const latest = useRef(EMPTY_PREFERENCES);

  useEffect(() => {
    let active = true;
    api("/api/workorder-preferences")
      .then(({ preferences: next }) => {
        if (!active) return;
        const value = { ...EMPTY_PREFERENCES, ...next };
        latest.current = value;
        setPreferences(value);
      })
      .catch(() => {})
      .finally(() => { if (active) setReady(true); });
    return () => {
      active = false;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  const save = useCallback((filters, options = {}) => {
    if (!ready) return;
    const next = {
      ...latest.current,
      defaultLocationId: options.defaultLocationId ?? latest.current.defaultLocationId,
      defaultView: options.defaultView || latest.current.defaultView,
      savedFilters: {
        ...latest.current.savedFilters,
        [scope]: filters,
      },
    };
    latest.current = next;
    setPreferences(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api("/api/workorder-preferences", {
        method: "PUT",
        body: JSON.stringify(next),
      }).catch(() => {});
    }, 350);
  }, [ready, scope]);

  return {
    ready,
    filters: preferences.savedFilters?.[scope] || {},
    preferences,
    save,
  };
}
