import React, { useState } from "react";
import { Button, Form, Input, Label, TextField } from "react-aria-components";
import { PasswordVisibilityToggle } from "../../components/ui/PasswordVisibilityToggle.jsx";
import { authClient } from "../../lib/auth-client.js";
import "./auth.css";

function returnToLogin() {
  window.location.replace("/");
}

export function ResetPasswordPage({ token, tokenError = "" }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [status, setStatus] = useState({ kind: "idle", message: "" });
  const busy = status.kind === "busy";
  const valid = password.length >= 12 && password === confirmation;

  async function submit(event) {
    event.preventDefault();
    if (!token || !valid || busy) return;
    setStatus({ kind: "busy", message: "Updating password..." });
    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (result.error) {
        setStatus({ kind: "error", message: "This reset link is invalid or expired. Request a new link." });
        return;
      }
      setStatus({ kind: "success", message: "Password changed. You can now sign in." });
    } catch {
      setStatus({ kind: "error", message: "This reset link is invalid or expired. Request a new link." });
    }
  }

  const invalidToken = !token || Boolean(tokenError);

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="reset-password-title">
        <header className="auth-heading auth-heading-text-only">
          <div className="auth-heading-copy">
            <h1 id="reset-password-title">Set new password</h1>
            <p>{invalidToken ? "This reset link is invalid or expired." : "Choose a new password for your account."}</p>
          </div>
        </header>

        {invalidToken ? (
          <Button className="auth-submit" onPress={returnToLogin}>Return to sign in</Button>
        ) : status.kind === "success" ? (
          <>
            <p className="auth-recovery-message auth-recovery-message-success" role="status">{status.message}</p>
            <Button className="auth-submit" onPress={returnToLogin}>Sign in</Button>
          </>
        ) : (
          <Form className="auth-form" onSubmit={submit} validationBehavior="native">
            <TextField isRequired value={password} onChange={setPassword}>
              <Label>New password</Label>
              <div className="auth-password-field password-input-control">
                <Input
                  id="reset-new-password"
                  type={showPassword ? "text" : "password"}
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
                <PasswordVisibilityToggle
                  visible={showPassword}
                  controls="reset-new-password"
                  onToggle={() => setShowPassword((current) => !current)}
                />
              </div>
            </TextField>

            <TextField isRequired value={confirmation} onChange={setConfirmation}>
              <Label>Confirm new password</Label>
              <div className="auth-password-field password-input-control">
                <Input
                  id="reset-confirm-password"
                  type={showConfirmation ? "text" : "password"}
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
                <PasswordVisibilityToggle
                  visible={showConfirmation}
                  controls="reset-confirm-password"
                  onToggle={() => setShowConfirmation((current) => !current)}
                />
              </div>
            </TextField>

            <div className="auth-password-rules" aria-live="polite">
              <span className={password.length >= 12 ? "valid" : ""}>At least 12 characters</span>
              <span className={confirmation && password === confirmation ? "valid" : confirmation ? "invalid" : ""}>Passwords match</span>
            </div>

            {status.message ? <p className="auth-error" role="alert">{status.message}</p> : null}

            <Button className="auth-submit" type="submit" isDisabled={!valid || busy}>
              {busy ? "Updating..." : "Set new password"}
            </Button>
          </Form>
        )}
      </section>
    </main>
  );
}
