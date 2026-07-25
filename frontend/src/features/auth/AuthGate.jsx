import React, { useEffect, useState } from "react";
import { LogOut01 } from "@untitledui/icons";
import { authClient } from "../../lib/auth-client.js";
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

  useEffect(() => {
    if (!session?.user) {
      setActor(null);
      setActorState("idle");
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
  if (!session?.user) return <LoginPage />;
  if (actorState === "error") return <AccessUnavailable message={actorError} />;
  if (!actor) return <LoadingScreen />;

  return children({ actor, session, authClient });
}
