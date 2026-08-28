import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { interfaceText, normalizeLocale } from "../i18n/index.js";

const EMPTY_PREFERENCES = {
  defaultLocationId: null,
  defaultView: "all",
  pageSize: 50,
  savedFilters: {},
  locale: "en",
};

export function useWorkorderPreferences(scope) {
  const [preferences, setPreferences] = useState(EMPTY_PREFERENCES);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const saveTimer = useRef(null);
  const latest = useRef(EMPTY_PREFERENCES);
  const localeSaveSequence = useRef(0);
  const localeSavePromise = useRef(Promise.resolve());

  useEffect(() => {
    let active = true;
    api("/api/workorder-preferences")
      .then(({ preferences: next }) => {
        if (!active) return;
        const value = { ...EMPTY_PREFERENCES, ...next, locale: normalizeLocale(next?.locale) };
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
      const { defaultLocationId, defaultView, savedFilters } = latest.current;
      api("/api/workorder-preferences", {
        method: "PUT",
        body: JSON.stringify({ defaultLocationId, defaultView, savedFilters }),
      }).catch(() => {});
    }, 350);
  }, [ready, scope]);

  const saveLocale = useCallback(async (requestedLocale) => {
    if (!ready) return false;
    const locale = normalizeLocale(requestedLocale);
    const request = ++localeSaveSequence.current;
    const previous = latest.current;
    const next = { ...previous, locale };
    latest.current = next;
    setPreferences(next);
    setError("");
    try {
      const requestPromise = localeSavePromise.current
        .catch(() => {})
        .then(() => api("/api/workorder-preferences", {
          method: "PUT",
          // Locale is intentionally a narrow patch; do not overwrite saved
          // filters or other preferences when a user changes language.
          body: JSON.stringify({ locale }),
        }));
      localeSavePromise.current = requestPromise;
      const result = await requestPromise;
      if (request !== localeSaveSequence.current) return false;
      const confirmed = {
        ...latest.current,
        locale: normalizeLocale(result.preferences?.locale ?? locale),
      };
      latest.current = confirmed;
      setPreferences(confirmed);
      return true;
    } catch (saveError) {
      if (request !== localeSaveSequence.current) return false;
      const restored = { ...latest.current, locale: previous.locale };
      latest.current = restored;
      setPreferences(restored);
      setError(locale === "en" && saveError?.message
        ? saveError.message
        : interfaceText(locale, "language.saveError"));
      return false;
    }
  }, [ready]);

  return {
    ready,
    error,
    filters: preferences.savedFilters?.[scope] || {},
    preferences,
    save,
    saveLocale,
  };
}
