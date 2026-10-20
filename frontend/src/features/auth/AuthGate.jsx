import React, { useCallback, useEffect, useRef, useState } from "react";
import { LogOut01 } from "@untitledui/icons";
import { authClient } from "../../lib/auth-client.js";
import { api } from "../../lib/api.js";
import { KioskGate, KioskStandardLogin } from "../kiosk/KioskGate.jsx";
import { KioskSessionProvider } from "../kiosk/KioskSessionContext.jsx";
import { purgeMechanicWorkStorage } from "../mechanic/progress/mechanic-work-storage.js";
import {
  shouldEnforceInactivity,
  useInactivitySession,
} from "./inactivity-session.js";
import { LoginPage } from "./LoginPage.jsx";
import { SignInHandoff } from "./SignInHandoff.jsx";
import { waitForSignedInSession } from "./signin-handoff.js";
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
    try {
      await authClient.signOut();
    } finally {
      purgeMechanicWorkStorage();
      window.location.replace("/");
    }
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
  const [entryMode, setEntryMode] = useState(null);
  const signingIn = entryMode === "standard";
  const kioskEntryActive = entryMode === "kiosk";
  const [kioskUnlocking, setKioskUnlocking] = useState(false);
  const [entryError, setEntryError] = useState("");
  const entrySessionSeen = useRef(false);
  const kioskEntryContext = useRef(null);
  const [actor, setActor] = useState(null);
  const [actorState, setActorState] = useState("idle");
  const [actorError, setActorError] = useState("");
  const [actorSession, setActorSession] = useState({ kiosk: null, sessionMode: "standard" });
  const [kioskContext, setKioskContext] = useState(undefined);
  const [standardLogin, setStandardLogin] = useState(false);

  useEffect(() => {
    if (session?.user) entrySessionSeen.current = true;
    else if (!isPending && entrySessionSeen.current) {
      entrySessionSeen.current = false;
      setEntryMode(null);
      setKioskUnlocking(false);
      kioskEntryContext.current = null;
      setEntryError("Your session ended. Sign in again.");
    }
  }, [session?.user?.id, isPending]);

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
      purgeMechanicWorkStorage();
      window.location.replace("/");
    }
  }, []);
  const inactivityEnabled = shouldEnforceInactivity({
    authenticated: Boolean(session?.user),
    role: actor?.role,
    sessionMode: actorSession.sessionMode,
  });
  const { warningSeconds } = useInactivitySession({
    enabled: inactivityEnabled,
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
        setActor({ ...body.user, productModuleAccess: body.productModuleAccess || null });
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

  const workspace = actor && actorState === "ready" && session?.user && !isPending ? (
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
  ) : null;

  const signIn = <SignInHandoff ready={Boolean(workspace)} workspace={workspace}>
    <LoginPage onSignInStart={() => { setEntryError(""); setEntryMode("standard"); }} onSignInError={() => setEntryMode(null)} onSignedIn={(signal) => waitForSignedInSession(authClient.$store.atoms.session, { signal })} signingIn={signingIn} handoffError={entryError} />
    {kioskContext?.registered ? <KioskStandardLogin onReturnToKiosk={() => setStandardLogin(false)} /> : null}
  </SignInHandoff>;

  const kioskSignIn = <SignInHandoff ready={Boolean(workspace)} workspace={workspace}>
    <KioskGate
      context={kioskEntryActive ? kioskEntryContext.current : kioskContext}
      onRefresh={() => { kioskEntryContext.current = null; setEntryMode(null); loadKioskContext(); }}
      onStandardLogin={() => { kioskEntryContext.current = null; setEntryMode(null); setStandardLogin(true); }}
      onReturnToRoster={() => { kioskEntryContext.current = null; setEntryMode(null); }}
      onUnlockStart={() => { kioskEntryContext.current = kioskEntryContext.current || kioskContext; setEntryError(""); setEntryMode("kiosk"); setKioskUnlocking(true); }}
      onUnlockError={() => setKioskUnlocking(false)}
      onUnlocked={(signal) => waitForSignedInSession(authClient.$store.atoms.session, { signal, refresh: () => authClient.$store.notify("$sessionSignal") })}
      unlocking={kioskUnlocking}
      handoffError={entryError}
    />
  </SignInHandoff>;

  if (actorState === "error" && session?.user) return <AccessUnavailable message={actorError} />;
  if (signingIn) return signIn;
  if (kioskEntryActive) return kioskSignIn;
  if (isPending || actorState === "loading") return <LoadingScreen />;
  if (!session?.user) {
    if (kioskContext === undefined) return <LoadingScreen />;
    if (kioskContext.registered && !standardLogin) {
      return kioskSignIn;
    }
    return signIn;
  }
  if (actorState === "error") return <AccessUnavailable message={actorError} />;
  if (!actor) return <LoadingScreen />;

  return workspace;
}
