import React, { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  Form,
  Heading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  TextField,
} from "react-aria-components";
import { authClient } from "../../lib/auth-client.js";

const GENERIC_SUCCESS = "If that email has an account, a reset link has been sent.";

export function ForgotPasswordDialog({ defaultEmail = "", isOpen, onOpenChange }) {
  const [email, setEmail] = useState(defaultEmail);
  const [status, setStatus] = useState({ kind: "idle", message: "" });
  const busy = status.kind === "busy";

  useEffect(() => {
    if (isOpen) {
      setEmail(defaultEmail.includes("@") ? defaultEmail.trim() : "");
      setStatus({ kind: "idle", message: "" });
    }
  }, [defaultEmail, isOpen]);

  async function submit(event) {
    event.preventDefault();
    if (!email.trim() || busy) return;
    setStatus({ kind: "busy", message: "Sending reset link..." });
    try {
      const redirectTo = `${window.location.origin}/?resetPassword=1`;
      const result = await authClient.requestPasswordReset({
        email: email.trim().toLowerCase(),
        redirectTo,
      });
      if (result.error) {
        setStatus({ kind: "error", message: "The reset link could not be sent. Try again shortly." });
        return;
      }
      setStatus({ kind: "success", message: GENERIC_SUCCESS });
    } catch {
      setStatus({ kind: "error", message: "The reset link could not be sent. Try again shortly." });
    }
  }

  return (
    <ModalOverlay
      className="auth-modal-overlay"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={!busy}
    >
      <Modal className="auth-modal">
        <Dialog className="auth-dialog" aria-labelledby="forgot-password-title">
          <div className="auth-dialog-heading">
            <div>
              <Heading id="forgot-password-title" slot="title">Reset password</Heading>
              <p>Enter the email used for your account.</p>
            </div>
            <Button
              className="auth-dialog-close"
              aria-label="Close password recovery"
              isDisabled={busy}
              onPress={() => onOpenChange(false)}
            >
              ×
            </Button>
          </div>

          <Form className="auth-form auth-recovery-form" onSubmit={submit} validationBehavior="native">
            <TextField isRequired type="email" value={email} onChange={setEmail}>
              <Label>Email</Label>
              <Input
                autoFocus
                autoComplete="email"
                autoCapitalize="none"
                enterKeyHint="send"
                spellCheck="false"
              />
            </TextField>

            {status.message ? (
              <p
                className={`auth-recovery-message auth-recovery-message-${status.kind}`}
                role={status.kind === "error" ? "alert" : "status"}
                aria-live="polite"
              >
                {status.message}
              </p>
            ) : null}

            <Button className="auth-submit" type="submit" isDisabled={busy || !email.trim()}>
              {busy ? "Sending..." : "Send reset link"}
            </Button>
          </Form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
