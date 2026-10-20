import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { workspaceEntryReady } from "./signin-handoff.js";

// Keep the actual sign-in form mounted while the authorized workspace loads.
// Fade between destinations only after the workspace is ready.
export function SignInHandoff({ ready, workspace, children }) {
  const [phase, setPhase] = useState("waiting");
  const loginRef = useRef(null);
  const workspaceRef = useRef(null);

  useEffect(() => {
    if (!ready && phase !== "waiting") setPhase("waiting");
  }, [ready, phase]);

  useEffect(() => {
    if (!ready || phase !== "waiting") return;
    const root = workspaceRef.current;
    let frame;
    let disposed = false;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!disposed && workspaceEntryReady(root)) setPhase("revealing");
      });
    };
    const observer = new MutationObserver(check);
    observer.observe(root, { childList: true, subtree: true, attributes: true });
    check();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [ready, phase]);

  useLayoutEffect(() => {
    if (!ready || phase !== "revealing") return;
    const login = loginRef.current;
    const root = workspaceRef.current;
    let disposed = false;
    const animations = [];
    function finish() {
      if (disposed) return;
      setPhase("complete");
    }
    if (!login?.animate || !root?.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    const exit = login.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, easing: "ease-in", fill: "both" });
    animations.push(exit);
    exit.finished.then(() => {
      if (disposed) return;
      const enter = root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 130, easing: "ease-out", fill: "both" });
      animations.push(enter);
      enter.finished.then(finish).catch(() => {});
    }).catch(() => {});
    return () => {
      disposed = true;
      animations.forEach((animation) => animation.cancel());
    };
  }, [phase, ready]);

  useLayoutEffect(() => {
    if (ready && phase === "complete") workspaceRef.current?.focus({ preventScroll: true });
  }, [phase, ready]);

  return <div className="auth-entry" data-phase={phase}>
    {phase !== "complete" ? <div ref={loginRef} className="auth-entry-login" inert={phase === "revealing" ? true : undefined} aria-hidden={phase === "revealing" ? true : undefined}>{children}</div> : null}
    {ready ? <div ref={workspaceRef} className="auth-entry-workspace" tabIndex={-1} inert={phase === "complete" ? undefined : true} aria-hidden={phase === "complete" ? undefined : true}>
      <Suspense fallback={<div data-auth-entry-loading="true" />}>{workspace}</Suspense>
    </div> : null}
  </div>;
}
