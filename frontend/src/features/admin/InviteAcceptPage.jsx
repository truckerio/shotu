import { useEffect, useState } from "react";
import { CheckCircle, ClipboardCheck } from "@untitledui/icons";
import { api } from "../../lib/api.js";
import "../auth/auth.css";

export function InviteAcceptPage({ token }) {
  const [invitation, setInvitation] = useState(null);
  const [state, setState] = useState({ loading: true, busy: false, error: "", complete: false });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    api(`/api/invitations/${encodeURIComponent(token)}`)
      .then(({ invitation: value }) => {
        setInvitation(value);
        setUsername(value.email.split("@")[0].replace(/[^a-zA-Z0-9_.]/g, ""));
        setState((current) => ({ ...current, loading: false }));
      })
      .catch((error) => setState({ loading: false, busy: false, error: error.message, complete: false }));
  }, [token]);

  async function accept(event) {
    event.preventDefault();
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      await api(`/api/invitations/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setState({ loading: false, busy: false, error: "", complete: true });
    } catch (error) {
      setState((current) => ({ ...current, busy: false, error: error.message }));
    }
  }

  if (state.loading) return <main className="auth-shell"><div className="auth-loading" /></main>;
  if (state.complete) {
    return (
      <main className="auth-shell">
        <section className="auth-panel auth-access-panel">
          <CheckCircle className="auth-complete-icon" />
          <h1>Account ready</h1>
          <p>Sign in with <strong>{username}</strong>.</p>
          <a className="auth-secondary-action" href="/">Go to sign in</a>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="invite-title">
        <header className="auth-heading">
          <span className="auth-mark" aria-hidden="true"><ClipboardCheck /></span>
          <div><strong>{invitation?.locationName || "Workorders"}</strong><h1 id="invite-title">Accept invitation</h1></div>
        </header>
        {state.error && !invitation ? <p className="auth-error" role="alert">{state.error}</p> : (
          <form className="auth-form" onSubmit={accept}>
            <label><span>Name</span><input value={invitation?.name || ""} disabled /></label>
            <label><span>Email</span><input value={invitation?.email || ""} disabled /></label>
            <label><span>Username</span><input value={username} onChange={(event) => setUsername(event.target.value)} minLength="3" required autoCapitalize="none" /></label>
            <label><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength="12" required autoComplete="new-password" /></label>
            {state.error ? <p className="auth-error" role="alert">{state.error}</p> : null}
            <button className="auth-submit" type="submit" disabled={state.busy}>{state.busy ? "Creating account..." : "Create account"}</button>
          </form>
        )}
      </section>
    </main>
  );
}
