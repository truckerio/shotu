import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearProgressBackup,
  readProgressBackup,
  writeProgressBackup,
} from "./progress-storage.js";

const DEFAULT_DEBOUNCE_MS = 900;

export function normalizedMechanicProgress(value) {
  return {
    ...(value?.concern === undefined ? {} : { concern: String(value.concern ?? "") }),
    diagnosis: String(value?.diagnosis || ""),
    workPerformed: String(value?.workPerformed || ""),
    laborHours: String(value?.laborHours ?? value?.formData?.laborHours ?? ""),
  };
}

export function editableMechanicProgress(value, { canSaveNotes = true, canSaveConcern = false } = {}) {
  const progress = normalizedMechanicProgress(value);
  return {
    ...(canSaveNotes ? { diagnosis: progress.diagnosis, workPerformed: progress.workPerformed, laborHours: progress.laborHours } : {}),
    ...(canSaveConcern && progress.concern !== undefined ? { concern: progress.concern } : {}),
  };
}

function fingerprint(value) {
  const progress = normalizedMechanicProgress(value);
  return JSON.stringify([progress.diagnosis, progress.workPerformed, progress.laborHours, progress.concern ?? null]);
}

export function shouldSyncMechanicProgressFromServer({ wasDirty, inFlight, localVersion, serverVersion, renderedValue, savedValue }) {
  return !wasDirty && !inFlight && Number(serverVersion) > Number(localVersion)
    && fingerprint(renderedValue) === fingerprint(savedValue);
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
    ...Object.fromEntries(Object.entries(normalizedMechanicProgress(value)).filter(([key]) => Object.hasOwn(value || {}, key))),
    recordActivity: Boolean(recordActivity),
  };
}

export function useMechanicProgress({
  actorId,
  workorderId,
  value,
  savedValue = value,
  initialVersion = 1,
  saveProgress,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  canSaveNotes = true,
  canSaveConcern = false,
}) {
  const scopeProgress = (next) => editableMechanicProgress(next, { canSaveNotes, canSaveConcern });
  const [status, setStatus] = useState("saved");
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(initialVersion || 1);
  const valueRef = useRef(scopeProgress(value));
  const versionRef = useRef(initialVersion || 1);
  const baselineRef = useRef(fingerprint(scopeProgress(value)));
  const activityBaselineRef = useRef(fingerprint(scopeProgress(value)));
  const workorderIdRef = useRef(workorderId);
  const actorIdRef = useRef(actorId);
  const timerRef = useRef(null);
  const inFlightRef = useRef(null);
  const mountedRef = useRef(true);
  const renderedValue = scopeProgress(value);
  const renderedFingerprint = fingerprint(renderedValue);
  const serverRebased = workorderId === workorderIdRef.current && shouldSyncMechanicProgressFromServer({
    wasDirty: fingerprint(valueRef.current) !== baselineRef.current,
    inFlight: Boolean(inFlightRef.current), localVersion: versionRef.current, serverVersion: initialVersion,
    renderedValue, savedValue: scopeProgress(savedValue),
  });
  if (serverRebased) {
    versionRef.current = Number(initialVersion);
    baselineRef.current = renderedFingerprint;
    activityBaselineRef.current = renderedFingerprint;
  }
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
      const hasNewerEdits = fingerprint(valueRef.current) !== currentFingerprint;
      if (hasNewerEdits) writeProgressBackup(actorIdRef.current, workorderIdRef.current, valueRef.current, versionRef.current);
      else clearProgressBackup(actorIdRef.current, workorderIdRef.current);
      if (mountedRef.current) {
        setVersion(versionRef.current);
        setStatus(hasNewerEdits ? "dirty" : "saved");
        setError(null);
      }
      return result;
    } catch (saveError) {
      writeProgressBackup(actorIdRef.current, workorderIdRef.current, valueRef.current, versionRef.current);
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
    const normalized = editableMechanicProgress(progress, { canSaveNotes, canSaveConcern });
    workorderIdRef.current = id;
    valueRef.current = normalized;
    versionRef.current = nextVersion || 1;
    baselineRef.current = fingerprint(normalized);
    activityBaselineRef.current = fingerprint(normalized);
    setVersion(versionRef.current);
    setStatus("saved");
    setError(null);
  }, [canSaveConcern, canSaveNotes, clearTimer]);

  useEffect(() => {
    if (!serverRebased) return;
    setVersion(versionRef.current);
    setStatus("saved");
    setError(null);
  }, [initialVersion, serverRebased]);

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

    writeProgressBackup(actorId, workorderId, valueRef.current, versionRef.current);
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
