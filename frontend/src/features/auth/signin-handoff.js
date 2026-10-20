export function waitForSignedInSession(sessionAtom, { signal, timeoutMs = 30000, refresh } = {}) {
  return new Promise((resolve, reject) => {
    let stop = () => {};
    let timeout;
    let settled = false;
    let sawRefresh = false;
    function finish(error) {
      if (settled) return;
      settled = true;
      stop();
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    }
    function abort() { finish(new DOMException("Sign-in was canceled.", "AbortError")); }
    function inspect(state, initial = false) {
      if (state.isPending || state.isRefetching) { sawRefresh = true; return; }
      if (state.data?.user) { finish(); return; }
      if (!initial && (sawRefresh || state.error)) finish(new Error("The sign-in session could not be confirmed."));
    }
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    // Better Auth refreshes this atom after sign-in. Do not start a competing
    // fetch: its scheduled refresh may replace an in-flight request.
    stop = sessionAtom.listen((state) => inspect(state));
    timeout = setTimeout(() => finish(new Error("Sign-in timed out. Try again.")), timeoutMs);
    try {
      refresh?.();
      inspect(sessionAtom.get(), true);
    } catch (error) {
      finish(error);
    }
  });
}

export function workspaceEntryReady(root) {
  return Boolean(root?.querySelector("main") && !root.querySelector("[data-auth-entry-loading], .app-recovery-loading, .route-loading"));
}
