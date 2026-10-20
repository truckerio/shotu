import React, { useEffect, useRef, useState } from "react";
import { Button, FieldError, Form, Input, Label, TextField } from "react-aria-components";
import { PasswordVisibilityToggle } from "../../components/ui/PasswordVisibilityToggle.jsx";
import { textEntryProps } from "../../components/forms/text-entry-policy.js";
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

export function loginReturnTarget(search = window.location.search) {
  const token = new URLSearchParams(search).get("inventoryScan")?.trim() || "";
  if (token.length < 8 || token.length > 2000) return "/";
  return `/?inventoryScan=${encodeURIComponent(token)}`;
}

export function LoginPage({ onSignInStart, onSignInError, onSignedIn, signingIn, handoffError = "" } = {}) {
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
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const handoffController = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; handoffController.current?.abort(); };
  }, []);

  useEffect(() => {
    if (signingIn === false) {
      handoffController.current?.abort();
      inFlightRef.current = false;
      setSubmitting(false);
      setPasskeySubmitting(false);
    }
  }, [signingIn]);

  useFocusedFieldVisibility({
    enabled: true,
    containerRef: shellRef,
    keyboardOpen,
    margin: 12,
  });

  async function submit(event) {
    event.preventDefault();
    if (inFlightRef.current || !identifier.trim() || !password) return;
    inFlightRef.current = true;
    handoffController.current = new AbortController();

    setSubmitting(true);
    setError("");
    onSignInStart?.();

    try {
      const result = identifier.includes("@")
        ? await authClient.signIn.email({
          email: identifier.trim(),
          password,
          rememberMe: true,
        })
        : await authClient.signIn.username({
          username: identifier.trim(),
          password,
          rememberMe: true,
        });

      if (!mountedRef.current) return;
      if (result.error) {
        setError(loginErrorMessage(result.error));
        setSubmitting(false);
        inFlightRef.current = false;
        onSignInError?.();
        return;
      }

      setPassword("");
      document.activeElement?.blur();
      window.history.replaceState(window.history.state, "", loginReturnTarget());
      await onSignedIn?.(handoffController.current.signal);
    } catch {
      if (!mountedRef.current) return;
      setError("Unable to sign in. Check your connection and try again.");
      setSubmitting(false);
      inFlightRef.current = false;
      onSignInError?.();
    }
  }

  async function signInWithPasskey() {
    if (inFlightRef.current) return;
    if (!window.PublicKeyCredential) {
      setError("Passkeys are not available in this browser. Use your password instead.");
      return;
    }

    inFlightRef.current = true;
    handoffController.current = new AbortController();
    setPasskeySubmitting(true);
    setError("");
    onSignInStart?.();

    try {
      const result = await authClient.signIn.passkey();
      if (!mountedRef.current) return;
      if (result?.error) {
        setError("Passkey sign-in was not completed. Try again or use your password.");
        setPasskeySubmitting(false);
        inFlightRef.current = false;
        onSignInError?.();
        return;
      }
      setPassword("");
      document.activeElement?.blur();
      window.history.replaceState(window.history.state, "", loginReturnTarget());
      await onSignedIn?.(handoffController.current.signal);
    } catch {
      if (!mountedRef.current) return;
      setError("Passkey sign-in was not completed. Try again or use your password.");
      setPasskeySubmitting(false);
      inFlightRef.current = false;
      onSignInError?.();
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
              {...textEntryProps("identifier")}
              autoComplete="username webauthn"
              enterKeyHint="next"
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
                {...textEntryProps("identifier")}
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

          {error || handoffError ? <p className="auth-error auth-login-error" role="alert">{error || handoffError}</p> : null}

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
