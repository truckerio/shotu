import { useCallback, useEffect, useRef, useState } from "react";
import {
  fingerprintDraftValue,
  mergeDraftResult,
  resolveMeaningful,
} from "./draft-utils.js";

const DEFAULT_DEBOUNCE_MS = 900;

/**
 * Owns draft persistence for a controlled form value.
 *
 * createDraft(payload) must resolve to a draft record containing an id and version.
 * updateDraft(id, { version, payload }) must resolve to the updated draft record.
 * discardDraft(id) may resolve to any value.
 */
export function useDraftForm({
  value,
  meaningful,
  draft: incomingDraft = null,
  createDraft,
  updateDraft,
  discardDraft: removeDraft,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}) {
  const initialPayload = incomingDraft?.payload ?? value;
  const [currentDraft, setCurrentDraft] = useState(incomingDraft);
  const [status, setStatus] = useState(incomingDraft?.id ? "saved" : "pristine");
  const [error, setError] = useState(null);

  const mountedRef = useRef(true);
  const valueRef = useRef(value);
  const meaningfulRef = useRef(resolveMeaningful(meaningful, value));
  const draftRef = useRef(incomingDraft);
  const baselineFingerprintRef = useRef(fingerprintDraftValue(initialPayload));
  const currentFingerprintRef = useRef(fingerprintDraftValue(value));
  const revisionRef = useRef(0);
  const requestEpochRef = useRef(0);
  const timerRef = useRef(null);
  const inFlightRef = useRef(null);
  const flushRef = useRef(null);
  const discardingRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hasUnsyncedChangesNow = useCallback(() => (
    currentFingerprintRef.current !== baselineFingerprintRef.current
    && (meaningfulRef.current || Boolean(draftRef.current?.id))
  ), []);

  const persistLatest = useCallback(async () => {
    clearTimer();
    if (discardingRef.current) return draftRef.current;

    if (inFlightRef.current) {
      try {
        await inFlightRef.current;
      } catch {
        // The latest state is retried below with the current version.
      }
    }

    if (!hasUnsyncedChangesNow()) return draftRef.current;

    const payload = valueRef.current;
    const payloadFingerprint = currentFingerprintRef.current;
    const saveRevision = revisionRef.current;
    const requestEpoch = requestEpochRef.current;
    const draftAtRequest = draftRef.current;

    if (mountedRef.current) {
      setStatus("saving");
      setError(null);
    }

    const request = Promise.resolve().then(() => {
      if (draftAtRequest?.id) {
        if (typeof updateDraft !== "function") {
          throw new Error("updateDraft is required to save an existing draft.");
        }
        return updateDraft(draftAtRequest.id, {
          version: draftAtRequest.version,
          payload,
        });
      }

      if (typeof createDraft !== "function") {
        throw new Error("createDraft is required to save a new draft.");
      }
      return createDraft(payload);
    });

    inFlightRef.current = request;

    try {
      const result = await request;
      if (requestEpoch !== requestEpochRef.current) return draftRef.current;

      const savedDraft = mergeDraftResult(draftAtRequest, result, payload);
      if (!savedDraft.id) {
        throw new Error("Draft persistence must return a draft id.");
      }

      draftRef.current = savedDraft;
      baselineFingerprintRef.current = payloadFingerprint;

      if (mountedRef.current) {
        setCurrentDraft(savedDraft);
        setStatus(revisionRef.current === saveRevision ? "saved" : "dirty");
        setError(null);
      }

      return savedDraft;
    } catch (saveError) {
      if (requestEpoch === requestEpochRef.current && mountedRef.current) {
        setStatus("error");
        setError(saveError);
      }
      throw saveError;
    } finally {
      if (inFlightRef.current === request) inFlightRef.current = null;
    }
  }, [clearTimer, createDraft, hasUnsyncedChangesNow, updateDraft]);

  const flush = useCallback(async () => {
    clearTimer();

    let savedDraft = draftRef.current;
    while (hasUnsyncedChangesNow()) {
      const revisionBeforeSave = revisionRef.current;
      savedDraft = await persistLatest();
      if (revisionRef.current === revisionBeforeSave) break;
    }
    return savedDraft;
  }, [clearTimer, hasUnsyncedChangesNow, persistLatest]);

  flushRef.current = flush;

  const discard = useCallback(async () => {
    clearTimer();
    discardingRef.current = true;

    try {
      if (inFlightRef.current) {
        try {
          await inFlightRef.current;
        } catch {
          // A failed save does not prevent the user from discarding the draft.
        }
      }

      clearTimer();
      const requestEpoch = ++requestEpochRef.current;
      const draftToDiscard = draftRef.current;
      if (draftToDiscard?.id) {
        if (typeof removeDraft !== "function") {
          throw new Error("discardDraft is required to remove a persisted draft.");
        }
        await removeDraft(draftToDiscard.id);
      }

      if (requestEpoch !== requestEpochRef.current) return null;

      draftRef.current = null;
      baselineFingerprintRef.current = currentFingerprintRef.current;
      if (mountedRef.current) {
        setCurrentDraft(null);
        setStatus("pristine");
        setError(null);
      }
      return null;
    } catch (discardError) {
      if (mountedRef.current) {
        setStatus("error");
        setError(discardError);
      }
      throw discardError;
    } finally {
      discardingRef.current = false;
    }
  }, [clearTimer, removeDraft]);

  const reset = useCallback((nextDraft = null) => {
    clearTimer();
    requestEpochRef.current += 1;
    const nextPayload = nextDraft?.payload ?? valueRef.current;
    const nextFingerprint = fingerprintDraftValue(nextPayload);

    draftRef.current = nextDraft;
    baselineFingerprintRef.current = nextFingerprint;
    currentFingerprintRef.current = fingerprintDraftValue(valueRef.current);
    revisionRef.current += 1;

    setCurrentDraft(nextDraft);
    setStatus("pristine");
    setError(null);
  }, [clearTimer]);

  useEffect(() => {
    if (!incomingDraft || incomingDraft === draftRef.current) return;
    const incomingFingerprint = fingerprintDraftValue(incomingDraft.payload ?? valueRef.current);
    const incomingMatchesValue = incomingFingerprint === currentFingerprintRef.current;
    if ((hasUnsyncedChangesNow() && !incomingMatchesValue) || inFlightRef.current) return;

    const currentVersion = draftRef.current?.version;
    const incomingVersion = incomingDraft.version;
    const isSameDraft = draftRef.current?.id === incomingDraft.id;
    const hasDifferentVersion = isSameDraft
      && currentVersion !== undefined
      && incomingVersion !== undefined
      && incomingVersion !== currentVersion;
    const hasNewerNumericVersion = hasDifferentVersion
      && typeof currentVersion === "number"
      && typeof incomingVersion === "number"
      && incomingVersion > currentVersion;

    if (hasDifferentVersion && !hasNewerNumericVersion) return;

    draftRef.current = incomingDraft;
    baselineFingerprintRef.current = incomingFingerprint;
    setCurrentDraft(incomingDraft);
    setStatus("saved");
    setError(null);
  }, [hasUnsyncedChangesNow, incomingDraft]);

  useEffect(() => {
    valueRef.current = value;
    meaningfulRef.current = resolveMeaningful(meaningful, value);

    const nextFingerprint = fingerprintDraftValue(value);
    if (nextFingerprint !== currentFingerprintRef.current) {
      currentFingerprintRef.current = nextFingerprint;
      revisionRef.current += 1;
    }

    const unsynced = hasUnsyncedChangesNow();
    if (!unsynced) {
      clearTimer();
      setStatus(draftRef.current?.id ? "saved" : "pristine");
      setError(null);
      return undefined;
    }

    setStatus("dirty");
    setError(null);
    clearTimer();
    if (!discardingRef.current) {
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        flushRef.current?.().catch(() => {});
      }, Math.max(0, debounceMs));
    }

    return clearTimer;
  }, [clearTimer, debounceMs, hasUnsyncedChangesNow, meaningful, value]);

  useEffect(() => () => {
    mountedRef.current = false;
    clearTimer();
    requestEpochRef.current += 1;
  }, [clearTimer]);

  const renderedFingerprint = fingerprintDraftValue(value);
  const renderedMeaningful = resolveMeaningful(meaningful, value);
  const hasMeaningfulChanges = renderedMeaningful
    && renderedFingerprint !== baselineFingerprintRef.current;
  const hasUnsyncedChanges = renderedFingerprint !== baselineFingerprintRef.current
    && (renderedMeaningful || Boolean(currentDraft?.id));

  return {
    draft: currentDraft,
    status,
    error,
    flush,
    discard,
    reset,
    hasMeaningfulChanges,
    hasUnsyncedChanges,
  };
}
