import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { authClient } from "../../lib/auth-client.js";
import { api } from "../../lib/api.js";
import { KIOSK_ACTIVITY_EVENTS, KIOSK_IDLE_TIMEOUT_MS } from "./kiosk-utils.js";

const KioskSessionContext = createContext(null);

export function useKioskSession() {
  return useContext(KioskSessionContext);
}

export function KioskSessionProvider({
  children,
  kiosk = null,
  registered = false,
  sessionMode = "standard",
}) {
  const [leaving, setLeaving] = useState(false);
  const hiddenAtRef = useRef(null);
  const timerRef = useRef(null);
  const kioskSession = sessionMode === "kiosk";
  const canSwitch = kioskSession || registered;

  const leaveForKiosk = useCallback(async (type = "switch") => {
    if (leaving) return;
    setLeaving(true);
    try {
      await api("/api/kiosk/event", {
        method: "POST",
        body: JSON.stringify({ type }),
      });
    } catch {
      // Sign-out remains fail-closed when audit recording is temporarily unavailable.
    }
    try {
      await authClient.signOut();
    } finally {
      window.location.replace("/");
    }
  }, [leaving]);

  useEffect(() => {
    if (!kioskSession) return undefined;

    function scheduleLock() {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => leaveForKiosk("lock"), KIOSK_IDLE_TIMEOUT_MS);
    }

    function recordActivity() {
      if (
        hiddenAtRef.current
        && Date.now() - hiddenAtRef.current >= KIOSK_IDLE_TIMEOUT_MS
      ) {
        leaveForKiosk("lock");
        return;
      }
      hiddenAtRef.current = null;
      scheduleLock();
    }

    function handleVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      recordActivity();
    }

    KIOSK_ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, recordActivity, { passive: true });
    });
    document.addEventListener("visibilitychange", handleVisibility);
    scheduleLock();

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      hiddenAtRef.current = null;
      KIOSK_ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, recordActivity);
      });
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [kioskSession, leaveForKiosk]);

  const value = useMemo(() => ({
    canSwitch,
    kiosk,
    kioskSession,
    leaving,
    leaveForKiosk,
    sessionMode,
  }), [canSwitch, kiosk, kioskSession, leaving, leaveForKiosk, sessionMode]);

  return (
    <KioskSessionContext.Provider value={value}>
      {children}
    </KioskSessionContext.Provider>
  );
}
