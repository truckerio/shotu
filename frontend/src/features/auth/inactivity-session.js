import { useEffect, useRef, useState } from "react";

export const INACTIVITY_TIMEOUT_MS = 120_000;
export const INACTIVITY_WARNING_MS = 30_000;

const CHANNEL_NAME = "owl-inactivity-session";
const STORAGE_KEY = "owl:inactivity-session";
const ACTIVITY_STATE_STORAGE_KEY = "owl:inactivity-session-state";
const ACTIVITY_BROADCAST_INTERVAL_MS = 1_000;

export function transitionInactivityState(state, event, now, timeoutMs = INACTIVITY_TIMEOUT_MS) {
  if (state.status === "expired") return state;

  if (event.type === "logout") {
    return { ...state, status: "expired" };
  }

  if (event.type === "activity") {
    const eventTime = Number(event.at);
    if (!Number.isFinite(eventTime) || eventTime <= 0 || eventTime > now + 1_000) return state;
    return { lastActivityAt: Math.max(state.lastActivityAt, eventTime), status: "active" };
  }

  if (now - state.lastActivityAt >= timeoutMs) {
    return { ...state, status: "expired" };
  }

  return state;
}

export function getInactivityRemainingMs(state, now, timeoutMs = INACTIVITY_TIMEOUT_MS) {
  return Math.max(0, timeoutMs - (now - state.lastActivityAt));
}

export function parseInactivityMessage(value) {
  try {
    const message = typeof value === "string" ? JSON.parse(value) : value;
    if (!message || (message.type !== "activity" && message.type !== "logout")) return null;
    if (!Number.isFinite(message.at) || message.at <= 0) return null;
    return {
      type: message.type,
      at: message.at,
      ...(typeof message.sessionKey === "string" && message.sessionKey ? { sessionKey: message.sessionKey } : {}),
    };
  } catch {
    return null;
  }
}

export function initialActivityTimestamp(value, sessionKey, now) {
  if (!sessionKey) return now;
  try {
    const stored = typeof value === "string" ? JSON.parse(value) : value;
    if (
      stored?.sessionKey !== sessionKey
      || !Number.isFinite(stored?.lastActivityAt)
      || stored.lastActivityAt <= 0
      || stored.lastActivityAt > now + 1_000
    ) return now;
    return stored.lastActivityAt;
  } catch {
    return now;
  }
}

export function useInactivitySession({
  enabled,
  onTimeout,
  sessionKey,
  timeoutMs = INACTIVITY_TIMEOUT_MS,
  warningMs = INACTIVITY_WARNING_MS,
}) {
  const [warningSeconds, setWarningSeconds] = useState(null);
  const onTimeoutRef = useRef(onTimeout);

  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  useEffect(() => {
    if (!enabled) {
      setWarningSeconds(null);
      return undefined;
    }

    const startedAt = Date.now();
    let storedActivity = null;
    try {
      storedActivity = localStorage.getItem(ACTIVITY_STATE_STORAGE_KEY);
    } catch {
      // Storage may be unavailable. Current page lifetime remains protected.
    }
    let state = {
      lastActivityAt: initialActivityTimestamp(storedActivity, sessionKey, startedAt),
      status: "active",
    };
    let timerId;
    let channel;
    let lastPublishedActivityAt = 0;
    let logoutStarted = false;

    const persistActivity = () => {
      if (!sessionKey) return;
      try {
        localStorage.setItem(ACTIVITY_STATE_STORAGE_KEY, JSON.stringify({
          sessionKey,
          lastActivityAt: state.lastActivityAt,
        }));
      } catch {
        // Storage may be unavailable. Current page lifetime remains protected.
      }
    };

    const publish = (message) => {
      const scopedMessage = sessionKey ? { ...message, sessionKey } : message;
      if (channel) {
        channel.postMessage(scopedMessage);
        return;
      }

      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...scopedMessage, nonce: `${Date.now()}:${Math.random()}` }),
        );
      } catch {
        // Storage may be unavailable. Current tab timeout remains enforced.
      }
    };

    const expire = (shouldPublish = true) => {
      if (logoutStarted) return;
      logoutStarted = true;
      state = { ...state, status: "expired" };
      setWarningSeconds(null);
      if (shouldPublish) publish({ type: "logout", at: Date.now() });
      void onTimeoutRef.current();
    };

    const scheduleCheck = () => {
      window.clearTimeout(timerId);
      const now = Date.now();
      state = transitionInactivityState(state, { type: "check" }, now, timeoutMs);
      if (state.status === "expired") {
        expire();
        return;
      }

      const remainingMs = getInactivityRemainingMs(state, now, timeoutMs);
      setWarningSeconds(remainingMs <= warningMs ? Math.max(1, Math.ceil(remainingMs / 1_000)) : null);
      timerId = window.setTimeout(scheduleCheck, Math.min(1_000, remainingMs));
    };

    const recordActivity = (event) => {
      if (!event.isTrusted || document.visibilityState === "hidden" || logoutStarted) return;
      const now = Date.now();
      state = transitionInactivityState(state, { type: "check" }, now, timeoutMs);
      if (state.status === "expired") {
        expire();
        return;
      }

      state = transitionInactivityState(state, { type: "activity", at: now }, now, timeoutMs);
      persistActivity();
      if (now - lastPublishedActivityAt >= ACTIVITY_BROADCAST_INTERVAL_MS) {
        lastPublishedActivityAt = now;
        publish({ type: "activity", at: now });
      }
      scheduleCheck();
    };

    const receiveMessage = (rawMessage) => {
      const message = parseInactivityMessage(rawMessage);
      if (!message || logoutStarted) return;
      if (message.sessionKey && sessionKey && message.sessionKey !== sessionKey) return;
      if (message.type === "logout") {
        expire(false);
        return;
      }

      const now = Date.now();
      state = transitionInactivityState(state, { type: "check" }, now, timeoutMs);
      if (state.status === "expired") {
        expire();
        return;
      }
      state = transitionInactivityState(state, message, now, timeoutMs);
      persistActivity();
      scheduleCheck();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleCheck();
    };
    const handleFocus = () => scheduleCheck();
    const handleStorage = (event) => {
      if (event.key === STORAGE_KEY && event.newValue) receiveMessage(event.newValue);
    };

    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener("message", (event) => receiveMessage(event.data));
    } else {
      window.addEventListener("storage", handleStorage);
    }

    const activityEvents = ["pointerdown", "pointermove", "keydown", "touchstart"];
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, recordActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    persistActivity();
    publish({ type: "activity", at: state.lastActivityAt });
    scheduleCheck();

    return () => {
      window.clearTimeout(timerId);
      for (const eventName of activityEvents) window.removeEventListener(eventName, recordActivity);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
      channel?.close();
    };
  }, [enabled, sessionKey, timeoutMs, warningMs]);

  return { warningSeconds };
}
