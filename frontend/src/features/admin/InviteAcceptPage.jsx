import { useEffect, useState } from "react";
import { CheckCircle } from "@untitledui/icons";
import { PasswordVisibilityToggle } from "../../components/ui/PasswordVisibilityToggle.jsx";
import { textEntryProps } from "../../components/forms/text-entry-policy.js";
import { api } from "../../lib/api.js";
import "../auth/auth.css";

export function InviteAcceptPage({ token }) {
  const [invitation, setInvitation] = useState(null);
  const [state, setState] = useState({ loading: true, busy: false, error: "", complete: false });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    api(`/api/invitations/${encodeURIComponent(token)}`)
      .then(({ invitation: value }) => {
        setInvitation(value);
        setUsername(value.email.split("@")[0].replace(/[^a-zA-Z0-9_.]/g, ""));
        setState((current) => ({ ...current, loading: false }));
      })
      .catch(() => setState({
        loading: false,
        busy: false,
        error: "This invitation link has expired or was replaced. Ask an admin to resend it.",
        complete: false,
      }));
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
    <main className="auth-shell auth-invite-shell">
      <section className="auth-panel auth-invite-panel" aria-labelledby="invite-title">
        <header className="auth-heading auth-heading-text-only auth-invite-heading">
          <div className="auth-heading-copy">
            {invitation?.locationName ? <small className="auth-context">{invitation.locationName}</small> : null}
            <h1 id="invite-title">Accept invitation</h1>
            <p>Create credentials for your work account.</p>
          </div>
        </header>
        {state.error && !invitation ? <p className="auth-error" role="alert">{state.error}</p> : (
          <form className="auth-form" onSubmit={accept}>
            <label><span>Name</span><input {...textEntryProps("name")} value={invitation?.name || ""} disabled /></label>
            <label><span>Email</span><input {...textEntryProps("identifier")} value={invitation?.email || ""} disabled /></label>
            <label><span>Username</span><input {...textEntryProps("identifier")} value={username} onChange={(event) => setUsername(event.target.value)} minLength="3" required /></label>
            <div className="password-field-group">
              <label htmlFor="invite-password"><span>Password</span></label>
              <div className="password-input-control">
                <input {...textEntryProps("identifier")} id="invite-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength="12" required autoComplete="new-password" />
                <PasswordVisibilityToggle visible={showPassword} controls="invite-password" onToggle={() => setShowPassword((current) => !current)} />
              </div>
            </div>
            {state.error ? <p className="auth-error" role="alert">{state.error}</p> : null}
            <button className="auth-submit" type="submit" disabled={state.busy}>{state.busy ? "Creating account..." : "Create account"}</button>
          </form>
        )}
      </section>
    </main>
  );
}
