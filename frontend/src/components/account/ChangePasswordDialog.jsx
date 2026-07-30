import React, { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  Heading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  TextField,
} from "react-aria-components";
import { authClient } from "../../lib/auth-client.js";
import { textEntryProps } from "../forms/text-entry-policy.js";
import { PasswordVisibilityToggle } from "../ui/PasswordVisibilityToggle.jsx";

const EMPTY_PASSWORDS = {
  current: "",
  next: "",
  confirmation: "",
};

function changePasswordError(error) {
  const code = String(error?.code || "").toUpperCase();
  if (code.includes("INVALID_PASSWORD") || code.includes("PASSWORD_MISMATCH")) {
    return "Current password is incorrect.";
  }
  return "Password could not be changed. Check your current password and try again.";
}

export function ChangePasswordDialog({ isOpen, onOpenChange }) {
  const [passwords, setPasswords] = useState(EMPTY_PASSWORDS);
  const [visible, setVisible] = useState({ current: false, next: false, confirmation: false });
  const [status, setStatus] = useState({ kind: "idle", message: "" });
  const busy = status.kind === "busy";
  const longEnough = passwords.next.length >= 12;
  const passwordsMatch = Boolean(passwords.confirmation) && passwords.next === passwords.confirmation;
  const canSubmit = Boolean(passwords.current) && longEnough && passwordsMatch && !busy;

  useEffect(() => {
    if (!isOpen) {
      setPasswords(EMPTY_PASSWORDS);
      setVisible({ current: false, next: false, confirmation: false });
      setStatus({ kind: "idle", message: "" });
    }
  }, [isOpen]);

  function updatePassword(field, value) {
    setPasswords((current) => ({ ...current, [field]: value }));
    if (status.kind === "error") setStatus({ kind: "idle", message: "" });
  }

  async function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setStatus({ kind: "busy", message: "Changing password..." });
    try {
      const result = await authClient.changePassword({
        currentPassword: passwords.current,
        newPassword: passwords.next,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setStatus({ kind: "error", message: changePasswordError(result.error) });
        return;
      }
      setPasswords(EMPTY_PASSWORDS);
      setStatus({ kind: "success", message: "Password changed. Other sessions were signed out." });
    } catch (error) {
      setStatus({ kind: "error", message: changePasswordError(error) });
    }
  }

  return (
    <ModalOverlay
      className="account-modal-overlay"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={!busy}
    >
      <Modal className="account-modal">
        <Dialog className="account-dialog" aria-labelledby="change-password-title">
          <div className="account-dialog-heading">
            <div>
              <Heading id="change-password-title" slot="title">Change password</Heading>
              <p>Use your current password to protect your account.</p>
            </div>
            <Button
              className="account-dialog-close"
              aria-label="Close password settings"
              isDisabled={busy}
              onPress={() => onOpenChange(false)}
            >
              ×
            </Button>
          </div>

          <form className="change-password-form" onSubmit={submit}>
            <TextField isRequired value={passwords.current} onChange={(value) => updatePassword("current", value)}>
              <Label>Current password</Label>
              <div className="password-input-control">
                <Input
                  {...textEntryProps("identifier")}
                  id="current-account-password"
                  autoFocus
                  type={visible.current ? "text" : "password"}
                  autoComplete="current-password"
                />
                <PasswordVisibilityToggle
                  visible={visible.current}
                  controls="current-account-password"
                  onToggle={() => setVisible((current) => ({ ...current, current: !current.current }))}
                />
              </div>
            </TextField>

            <TextField isRequired value={passwords.next} onChange={(value) => updatePassword("next", value)}>
              <Label>New password</Label>
              <div className="password-input-control">
                <Input
                  {...textEntryProps("identifier")}
                  id="new-account-password"
                  type={visible.next ? "text" : "password"}
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
                <PasswordVisibilityToggle
                  visible={visible.next}
                  controls="new-account-password"
                  onToggle={() => setVisible((current) => ({ ...current, next: !current.next }))}
                />
              </div>
            </TextField>

            <TextField isRequired value={passwords.confirmation} onChange={(value) => updatePassword("confirmation", value)}>
              <Label>Confirm new password</Label>
              <div className="password-input-control">
                <Input
                  {...textEntryProps("identifier")}
                  id="confirm-account-password"
                  type={visible.confirmation ? "text" : "password"}
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
                <PasswordVisibilityToggle
                  visible={visible.confirmation}
                  controls="confirm-account-password"
                  onToggle={() => setVisible((current) => ({ ...current, confirmation: !current.confirmation }))}
                />
              </div>
            </TextField>

            <div className="change-password-rules" aria-live="polite">
              <span className={longEnough ? "valid" : ""}>At least 12 characters</span>
              <span className={passwordsMatch ? "valid" : passwords.confirmation ? "invalid" : ""}>Passwords match</span>
            </div>

            {status.message ? (
              <p
                className={`account-dialog-message account-dialog-message-${status.kind}`}
                role={status.kind === "error" ? "alert" : "status"}
                aria-live="polite"
              >
                {status.message}
              </p>
            ) : null}

            <Button className="change-password-submit" type="submit" isDisabled={!canSubmit}>
              {busy ? "Changing password..." : "Change password"}
            </Button>
          </form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
