import React, { useState } from "react";
import { ClipboardCheck } from "@untitledui/icons";
import { Button, FieldError, Form, Input, Label, TextField } from "react-aria-components";
import { OwlWordmark } from "../../components/brand/OwlWordmark.jsx";
import { PasswordVisibilityToggle } from "../../components/ui/PasswordVisibilityToggle.jsx";
import { useVisualViewport } from "../../hooks/useVisualViewport.js";
import { authClient } from "../../lib/auth-client.js";
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
  const [error, setError] = useState("");

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

  const viewportStyle = {
    "--auth-visual-viewport-height": viewportHeight ? `${viewportHeight}px` : "100dvh",
    "--auth-visual-viewport-offset-top": `${viewportOffsetTop}px`,
  };

  return (
    <main
      className={`auth-shell${keyboardOpen ? " auth-shell--keyboard-open" : ""}`}
      data-keyboard-open={keyboardOpen ? "true" : "false"}
      style={viewportStyle}
    >
      <section className="auth-panel" aria-labelledby="login-title">
        <header className="auth-heading">
          <span className="auth-mark" aria-hidden="true">
            <ClipboardCheck />
          </span>
          <div>
            <OwlWordmark />
            <h1 id="login-title">Sign in</h1>
          </div>
        </header>

        <Form className="auth-form" onSubmit={submit} validationBehavior="native">
          <TextField isRequired name="identifier" value={identifier} onChange={setIdentifier}>
            <Label>Username or email</Label>
            <Input
              autoComplete="username"
              autoCapitalize="none"
              enterKeyHint="next"
              spellCheck="false"
            />
            <FieldError />
          </TextField>

          <TextField isRequired name="password" value={password} onChange={setPassword}>
            <Label>Password</Label>
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

          {error ? <p className="auth-error" role="alert">{error}</p> : null}

          <Button className="auth-submit" type="submit" isDisabled={submitting || !identifier.trim() || !password}>
            {submitting ? "Signing in..." : "Sign in"}
          </Button>
        </Form>
      </section>
    </main>
  );
}
