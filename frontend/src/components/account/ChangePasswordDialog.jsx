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
import { interfaceText } from "../../i18n/index.js";

const EMPTY_PASSWORDS = {
  current: "",
  next: "",
  confirmation: "",
};

function changePasswordError(error, locale) {
  const code = String(error?.code || "").toUpperCase();
  if (code.includes("INVALID_PASSWORD") || code.includes("PASSWORD_MISMATCH")) {
    return interfaceText(locale, "account.passwordIncorrect");
  }
  return interfaceText(locale, "account.passwordChangeError");
}

export function ChangePasswordDialog({ isOpen, onOpenChange, locale = "en" }) {
  const t = (key) => interfaceText(locale, key);
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
    setStatus({ kind: "busy", message: t("account.changingPassword") });
    try {
      const result = await authClient.changePassword({
        currentPassword: passwords.current,
        newPassword: passwords.next,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setStatus({ kind: "error", message: changePasswordError(result.error, locale) });
        return;
      }
      setPasswords(EMPTY_PASSWORDS);
      setStatus({ kind: "success", message: t("account.passwordChanged") });
    } catch (error) {
      setStatus({ kind: "error", message: changePasswordError(error, locale) });
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
              <Heading id="change-password-title" slot="title">{t("account.changePassword")}</Heading>
              <p>{t("account.passwordHelp")}</p>
            </div>
            <Button
              className="account-dialog-close"
              aria-label={t("account.closePasswordSettings")}
              isDisabled={busy}
              onPress={() => onOpenChange(false)}
            >
              ×
            </Button>
          </div>

          <form className="change-password-form" onSubmit={submit}>
            <TextField isRequired value={passwords.current} onChange={(value) => updatePassword("current", value)}>
              <Label>{t("account.currentPassword")}</Label>
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
                  hideLabel={t("account.hidePassword")}
                  showLabel={t("account.showPassword")}
                />
              </div>
            </TextField>

            <TextField isRequired value={passwords.next} onChange={(value) => updatePassword("next", value)}>
              <Label>{t("account.newPassword")}</Label>
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
                  hideLabel={t("account.hidePassword")}
                  showLabel={t("account.showPassword")}
                />
              </div>
            </TextField>

            <TextField isRequired value={passwords.confirmation} onChange={(value) => updatePassword("confirmation", value)}>
              <Label>{t("account.confirmNewPassword")}</Label>
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
                  hideLabel={t("account.hidePassword")}
                  showLabel={t("account.showPassword")}
                />
              </div>
            </TextField>

            <div className="change-password-rules" aria-live="polite">
              <span className={longEnough ? "valid" : ""}>{t("account.passwordMinimum")}</span>
              <span className={passwordsMatch ? "valid" : passwords.confirmation ? "invalid" : ""}>{t("account.passwordsMatch")}</span>
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
              {busy ? t("account.changingPassword") : t("account.changePassword")}
            </Button>
          </form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
