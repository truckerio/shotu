import React, { useRef, useState } from "react";
import { Button, FieldError, Form, Input, Label, TextField } from "react-aria-components";
import { PasswordVisibilityToggle } from "../../components/ui/PasswordVisibilityToggle.jsx";
import { useFocusedFieldVisibility } from "../../hooks/useFocusedFieldVisibility.js";
import { useVisualViewport } from "../../hooks/useVisualViewport.js";
import { authClient } from "../../lib/auth-client.js";
import { ForgotPasswordDialog } from "./ForgotPasswordDialog.jsx";
import "./auth.css";

function loginErrorMessage(error) {
  if (!error) return "Unable to sign in.";
  if (error.status === 429) return "Too many attempts. Wait a moment and try again.";
  return "Username or password is incorrect.";
}

export function LoginPage() {
  const {
    keyboardOpen,
    viewportHeight,
    viewportOffsetTop,
  } = useVisualViewport();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const [error, setError] = useState("");
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const shellRef = useRef(null);

  useFocusedFieldVisibility({
    enabled: true,
    containerRef: shellRef,
    keyboardOpen,
    margin: 12,
  });

  async function submit(event) {
    event.preventDefault();
    if (!identifier.trim() || !password) return;

    setSubmitting(true);
    setError("");

    const result = identifier.includes("@")
      ? await authClient.signIn.email({ email: identifier.trim(), password })
      : await authClient.signIn.username({ username: identifier.trim(), password });

    if (result.error) {
      setError(loginErrorMessage(result.error));
      setSubmitting(false);
      return;
    }

    window.location.replace("/");
  }

  async function signInWithPasskey() {
    if (!window.PublicKeyCredential) {
      setError("Passkeys are not available in this browser. Use your password instead.");
      return;
    }

    setPasskeySubmitting(true);
    setError("");

    try {
      const result = await authClient.signIn.passkey();
      if (result?.error) {
        setError("Passkey sign-in was not completed. Try again or use your password.");
        setPasskeySubmitting(false);
        return;
      }
      window.location.replace("/");
    } catch {
      setError("Passkey sign-in was not completed. Try again or use your password.");
      setPasskeySubmitting(false);
    }
  }

  const viewportStyle = {
    "--auth-visual-viewport-height": viewportHeight ? `${viewportHeight}px` : "100dvh",
    "--auth-visual-viewport-offset-top": `${viewportOffsetTop}px`,
  };

  return (
    <main
      ref={shellRef}
      className={`auth-shell${keyboardOpen ? " auth-shell--keyboard-open" : ""}`}
      data-keyboard-open={keyboardOpen ? "true" : "false"}
      style={viewportStyle}
    >
      <section className="auth-panel" aria-labelledby="login-title">
        <header className="auth-heading auth-heading-text-only">
          <div className="auth-heading-copy">
            <h1 id="login-title">Sign in</h1>
            <p>Use your work account to continue.</p>
          </div>
        </header>

        <Button
          className="auth-passkey-submit"
          type="button"
          isDisabled={passkeySubmitting || submitting}
          onPress={signInWithPasskey}
        >
          {passkeySubmitting ? "Waiting for passkey..." : "Sign in with a passkey"}
        </Button>

        <div className="auth-divider" aria-hidden="true">
          <span>or use your password</span>
        </div>

        <Form className="auth-form" onSubmit={submit} validationBehavior="native">
          <TextField isRequired name="identifier" value={identifier} onChange={setIdentifier}>
            <Label>Username or email</Label>
            <Input
              autoComplete="username webauthn"
              autoCapitalize="none"
              enterKeyHint="next"
              spellCheck="false"
            />
            <FieldError />
          </TextField>

          <TextField isRequired name="password" value={password} onChange={setPassword}>
            <div className="auth-password-label">
              <Label>Password</Label>
              <Button type="button" onPress={() => setForgotPasswordOpen(true)}>Forgot password?</Button>
            </div>
            <div className="auth-password-field password-input-control">
              <Input
                id="login-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                enterKeyHint="done"
              />
              <PasswordVisibilityToggle
                visible={showPassword}
                controls="login-password"
                onToggle={() => setShowPassword((current) => !current)}
              />
            </div>
            <FieldError />
          </TextField>

          {error ? <p className="auth-error auth-login-error" role="alert">{error}</p> : null}

          <Button className="auth-submit" type="submit" isDisabled={submitting || passkeySubmitting || !identifier.trim() || !password}>
            {submitting ? "Signing in..." : "Sign in"}
          </Button>
        </Form>
      </section>
      <ForgotPasswordDialog
        defaultEmail={identifier}
        isOpen={forgotPasswordOpen}
        onOpenChange={setForgotPasswordOpen}
      />
    </main>
  );
}
