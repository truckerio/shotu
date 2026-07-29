import React, { useCallback, useEffect, useState } from "react";
import { LogOut01 } from "@untitledui/icons";
import { authClient } from "../../lib/auth-client.js";
import { api } from "../../lib/api.js";
import { KioskGate, KioskStandardLogin } from "../kiosk/KioskGate.jsx";
import { KioskSessionProvider } from "../kiosk/KioskSessionContext.jsx";
import { useInactivitySession } from "./inactivity-session.js";
import { LoginPage } from "./LoginPage.jsx";
import "./auth.css";

function LoadingScreen() {
  return (
    <main className="auth-shell" aria-busy="true" aria-label="Loading account">
      <div className="auth-loading" />
    </main>
  );
}

function AccessUnavailable({ message }) {
  async function signOut() {
    await authClient.signOut();
    window.location.replace("/");
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel auth-access-panel">
        <h1>Account unavailable</h1>
        <p>{message}</p>
        <button type="button" className="auth-secondary-action" onClick={signOut}>
          <LogOut01 />
          Sign out
        </button>
      </section>
    </main>
  );
}

export function AuthGate({ children }) {
  const { data: session, isPending } = authClient.useSession();
  const [actor, setActor] = useState(null);
  const [actorState, setActorState] = useState("idle");
  const [actorError, setActorError] = useState("");
  const [actorSession, setActorSession] = useState({ kiosk: null, sessionMode: "standard" });
  const [kioskContext, setKioskContext] = useState(undefined);
  const [standardLogin, setStandardLogin] = useState(false);

  const loadKioskContext = useCallback(async () => {
    setKioskContext(undefined);
    try {
      const context = await api("/api/kiosk/context");
      setKioskContext(context?.registered ? context : { registered: false });
    } catch {
      setKioskContext({ registered: false });
    }
  }, []);

  useEffect(() => {
    loadKioskContext();
    window.addEventListener("kiosk-registration-changed", loadKioskContext);
    return () => window.removeEventListener("kiosk-registration-changed", loadKioskContext);
  }, [loadKioskContext]);

  const endInactiveSession = useCallback(async () => {
    try {
      await authClient.signOut();
    } finally {
      window.location.replace("/");
    }
  }, []);
  const { warningSeconds } = useInactivitySession({
    enabled: Boolean(session?.user),
    sessionKey: session?.session?.id,
    onTimeout: endInactiveSession,
  });

  useEffect(() => {
    if (!session?.user) {
      setActor(null);
      setActorState("idle");
      setActorSession({ kiosk: null, sessionMode: "standard" });
      return;
    }

    const controller = new AbortController();
    setActorState("loading");
    setActorError("");

    fetch("/api/me", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "This account is not linked to a workorder profile.");
        return body;
      })
      .then((body) => {
        setActor(body.user);
        setActorSession({
          kiosk: body.kiosk || null,
          sessionMode: body.sessionMode === "kiosk" ? "kiosk" : "standard",
        });
        setActorState("ready");
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        setActorError(error.message);
        setActorState("error");
      });

    return () => controller.abort();
  }, [session?.user?.id]);

  if (isPending || actorState === "loading") return <LoadingScreen />;
  if (!session?.user) {
    if (kioskContext === undefined) return <LoadingScreen />;
    if (kioskContext.registered && !standardLogin) {
      return (
        <KioskGate
          context={kioskContext}
          onRefresh={loadKioskContext}
          onStandardLogin={() => setStandardLogin(true)}
        />
      );
    }
    return (
      <>
        <LoginPage />
        {kioskContext.registered ? (
          <KioskStandardLogin onReturnToKiosk={() => setStandardLogin(false)} />
        ) : null}
      </>
    );
  }
  if (actorState === "error") return <AccessUnavailable message={actorError} />;
  if (!actor) return <LoadingScreen />;

  return (
    <KioskSessionProvider
      kiosk={actorSession.kiosk}
      registered={Boolean(kioskContext?.registered)}
      sessionMode={actorSession.sessionMode}
    >
      {children({ actor, session, authClient })}
      {warningSeconds ? (
        <div className="auth-inactivity-warning" role="status" aria-live="polite">
          Signing out in {warningSeconds} seconds due to inactivity.
        </div>
      ) : null}
    </KioskSessionProvider>
  );
}
