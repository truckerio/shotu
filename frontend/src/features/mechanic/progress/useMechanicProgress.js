import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearProgressBackup,
  readProgressBackup,
  writeProgressBackup,
} from "./progress-storage.js";

const DEFAULT_DEBOUNCE_MS = 900;

export function normalizedMechanicProgress(value) {
  return {
    diagnosis: String(value?.diagnosis || ""),
    workPerformed: String(value?.workPerformed || ""),
  };
}

function fingerprint(value) {
  const progress = normalizedMechanicProgress(value);
  return JSON.stringify([progress.diagnosis, progress.workPerformed]);
}

export function mechanicProgressRequest({
  workorderId,
  expectedVersion,
  value,
  recordActivity,
}) {
  return {
    workorderId,
    expectedVersion,
    ...normalizedMechanicProgress(value),
    recordActivity: Boolean(recordActivity),
  };
}

export function useMechanicProgress({
  actorId,
  workorderId,
  value,
  initialVersion = 1,
  saveProgress,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}) {
  const [status, setStatus] = useState("saved");
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(initialVersion || 1);
  const valueRef = useRef(normalizedMechanicProgress(value));
  const versionRef = useRef(initialVersion || 1);
  const baselineRef = useRef(fingerprint(value));
  const activityBaselineRef = useRef(fingerprint(value));
  const workorderIdRef = useRef(workorderId);
  const actorIdRef = useRef(actorId);
  const timerRef = useRef(null);
  const inFlightRef = useRef(null);
  const mountedRef = useRef(true);
  const renderedValue = normalizedMechanicProgress(value);
  const renderedFingerprint = fingerprint(renderedValue);
  if (workorderId === workorderIdRef.current) {
    valueRef.current = renderedValue;
  }

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const persist = useCallback(async ({ recordActivity = false } = {}) => {
    clearTimer();
    if (!workorderIdRef.current || typeof saveProgress !== "function") return null;
    if (inFlightRef.current) {
      try {
        await inFlightRef.current;
      } catch {
        // Retry the latest value below using the current version.
      }
    }

    const currentValue = valueRef.current;
    const currentFingerprint = fingerprint(currentValue);
    const needsSave = currentFingerprint !== baselineRef.current;
    const needsActivity = recordActivity && currentFingerprint !== activityBaselineRef.current;
    if (!needsSave && !needsActivity) return null;

    if (mountedRef.current) {
      setStatus("saving");
      setError(null);
    }
    const request = Promise.resolve(saveProgress(mechanicProgressRequest({
      workorderId: workorderIdRef.current,
      expectedVersion: versionRef.current,
      value: currentValue,
      recordActivity: needsActivity,
    })));
    inFlightRef.current = request;

    try {
      const result = await request;
      const progress = result?.progress || result || {};
      versionRef.current = Number(progress.version || result?.version || versionRef.current);
      baselineRef.current = currentFingerprint;
      if (needsActivity) activityBaselineRef.current = currentFingerprint;
      clearProgressBackup(actorIdRef.current, workorderIdRef.current);
      if (mountedRef.current) {
        setVersion(versionRef.current);
        setStatus("saved");
        setError(null);
      }
      return result;
    } catch (saveError) {
      writeProgressBackup(actorIdRef.current, workorderIdRef.current, currentValue);
      if (mountedRef.current) {
        setStatus("error");
        setError(saveError);
      }
      throw saveError;
    } finally {
      if (inFlightRef.current === request) inFlightRef.current = null;
    }
  }, [clearTimer, saveProgress]);

  const flush = useCallback((options) => persist(options), [persist]);

  const reset = useCallback(({
    id,
    progress,
    nextVersion = 1,
  }) => {
    clearTimer();
    const normalized = normalizedMechanicProgress(progress);
    workorderIdRef.current = id;
    valueRef.current = normalized;
    versionRef.current = nextVersion || 1;
    baselineRef.current = fingerprint(normalized);
    activityBaselineRef.current = fingerprint(normalized);
    setVersion(versionRef.current);
    setStatus("saved");
    setError(null);
  }, [clearTimer]);

  useEffect(() => {
    actorIdRef.current = actorId;
  }, [actorId]);

  useEffect(() => {
    if (workorderId === workorderIdRef.current) return;
    reset({ id: workorderId, progress: value, nextVersion: initialVersion });
  }, [initialVersion, reset, value, workorderId]);

  useEffect(() => {
    if (!workorderId) return undefined;
    if (renderedFingerprint === baselineRef.current) return undefined;

    writeProgressBackup(actorId, workorderId, valueRef.current);
    setStatus("dirty");
    setError(null);
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      persist({ recordActivity: true }).catch(() => {});
    }, Math.max(0, debounceMs));
    return clearTimer;
  }, [actorId, clearTimer, debounceMs, persist, renderedFingerprint, workorderId]);

  useEffect(() => () => {
    mountedRef.current = false;
    clearTimer();
  }, [clearTimer]);

  return {
    status,
    error,
    version,
    flush,
    reset,
    backup: readProgressBackup(actorId, workorderId),
    hasUnsyncedChanges: Boolean(workorderId) && renderedFingerprint !== baselineRef.current,
  };
}
