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
import { interfaceText, intlLocale } from "../../i18n/index.js";

function passkeyLabel(passkey, locale) {
  return passkey.name?.trim() || interfaceText(locale, "account.unnamedPasskey");
}

function passkeyDate(value, locale) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" }).format(date);
}

function errorMessage(action, locale) {
  return interfaceText(locale, `account.passkeyError.${action}`);
}

export function PasskeyManager({ isOpen, onOpenChange, locale = "en" }) {
  const t = (key) => interfaceText(locale, key);
  const [passkeys, setPasskeys] = useState([]);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [confirmingId, setConfirmingId] = useState("");
  const [status, setStatus] = useState({ kind: "idle", message: "" });
  const busy = status.kind === "busy";

  async function loadPasskeys() {
    setStatus({ kind: "busy", message: t("account.loadingPasskeys") });
    try {
      const result = await authClient.passkey.listUserPasskeys();
      if (result.error) {
        setStatus({ kind: "error", message: errorMessage("load", locale) });
        return;
      }
      setPasskeys(result.data ?? []);
      setStatus({ kind: "idle", message: "" });
    } catch {
      setStatus({ kind: "error", message: errorMessage("load", locale) });
    }
  }

  useEffect(() => {
    if (isOpen) void loadPasskeys();
  }, [isOpen]);

  async function registerPasskey(event) {
    event.preventDefault();
    setStatus({ kind: "busy", message: t("account.followDevicePrompts") });
    try {
      const result = await authClient.passkey.addPasskey({
        name: name.trim() || undefined,
      });
      if (result?.error) {
        setStatus({ kind: "error", message: errorMessage("add", locale) });
        return;
      }
      setName("");
      await loadPasskeys();
      setStatus({ kind: "success", message: t("account.passkeyAdded") });
    } catch {
      setStatus({ kind: "error", message: errorMessage("add", locale) });
    }
  }

  async function renamePasskey(event, id) {
    event.preventDefault();
    const nextName = editingName.trim();
    if (!nextName) return;
    setStatus({ kind: "busy", message: t("account.renamingPasskey") });
    try {
      const result = await authClient.passkey.updatePasskey({ id, name: nextName });
      if (result.error) {
        setStatus({ kind: "error", message: errorMessage("rename", locale) });
        return;
      }
      setPasskeys((current) => current.map((item) => (
        item.id === id ? { ...item, name: nextName } : item
      )));
      setEditingId("");
      setEditingName("");
      setStatus({ kind: "success", message: t("account.passkeyRenamed") });
    } catch {
      setStatus({ kind: "error", message: errorMessage("rename", locale) });
    }
  }

  async function removePasskey(id) {
    setStatus({ kind: "busy", message: t("account.removingPasskey") });
    try {
      const result = await authClient.passkey.deletePasskey({ id });
      if (result.error) {
        setStatus({ kind: "error", message: errorMessage("remove", locale) });
        return;
      }
      setPasskeys((current) => current.filter((item) => item.id !== id));
      setConfirmingId("");
      setStatus({ kind: "success", message: t("account.passkeyRemoved") });
    } catch {
      setStatus({ kind: "error", message: errorMessage("remove", locale) });
    }
  }

  return (
    <ModalOverlay
      className="passkey-modal-overlay"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={!busy}
    >
      <Modal className="passkey-modal">
        <Dialog className="passkey-dialog" aria-labelledby="passkey-dialog-title">
          <div className="passkey-dialog-heading">
            <div>
              <Heading id="passkey-dialog-title" slot="title">{t("account.passkeys")}</Heading>
              <p>{t("account.passkeyHelp")}</p>
            </div>
            <Button
              className="passkey-close"
              aria-label={t("account.closePasskeySettings")}
              isDisabled={busy}
              onPress={() => onOpenChange(false)}
            >
              ×
            </Button>
          </div>

          <form className="passkey-register" onSubmit={registerPasskey}>
            <TextField value={name} onChange={setName}>
              <Label>{t("account.passkeyName")} <span>{t("account.optional")}</span></Label>
              <Input {...textEntryProps("name")} placeholder={t("account.passkeyExample")} autoComplete="off" />
            </TextField>
            <Button type="submit" isDisabled={busy || !window.PublicKeyCredential}>
              {busy ? t("account.pleaseWait") : t("account.addPasskey")}
            </Button>
          </form>

          {!window.PublicKeyCredential ? (
            <p className="passkey-message passkey-message-error" role="alert">
              {t("account.passkeysUnavailable")}
            </p>
          ) : null}
          {status.message ? (
            <p
              className={`passkey-message passkey-message-${status.kind}`}
              role={status.kind === "error" ? "alert" : "status"}
              aria-live="polite"
            >
              {status.message}
            </p>
          ) : null}

          <div className="passkey-list-heading">
            <h3>{t("account.yourPasskeys")}</h3>
            <Button onPress={loadPasskeys} isDisabled={busy}>{t("account.refresh")}</Button>
          </div>

          {!busy && passkeys.length === 0 ? (
            <p className="passkey-empty">{t("account.noPasskeys")}</p>
          ) : (
            <ul className="passkey-list">
              {passkeys.map((passkey) => (
                <li key={passkey.id} className="passkey-item">
                  {editingId === passkey.id ? (
                    <form className="passkey-rename" onSubmit={(event) => renamePasskey(event, passkey.id)}>
                      <TextField
                        aria-label={t("account.newPasskeyName")}
                        value={editingName}
                        onChange={setEditingName}
                      >
                        <Input {...textEntryProps("name")} autoFocus />
                      </TextField>
                      <Button type="submit" isDisabled={busy || !editingName.trim()}>{t("account.save")}</Button>
                      <Button type="button" isDisabled={busy} onPress={() => setEditingId("")}>{t("account.cancel")}</Button>
                    </form>
                  ) : (
                    <>
                      <div className="passkey-item-copy">
                        <strong>{passkeyLabel(passkey, locale)}</strong>
                        {passkeyDate(passkey.createdAt, locale) ? <small>{t("account.added")} {passkeyDate(passkey.createdAt, locale)}</small> : null}
                      </div>
                      <div className="passkey-item-actions">
                        <Button
                          isDisabled={busy}
                          onPress={() => {
                            setConfirmingId("");
                            setEditingId(passkey.id);
                            setEditingName(passkeyLabel(passkey, locale));
                          }}
                        >
                          {t("account.rename")}
                        </Button>
                        {confirmingId === passkey.id ? (
                          <>
                            <span>{t("account.removePasskeyQuestion")}</span>
                            <Button className="passkey-remove-confirm" isDisabled={busy} onPress={() => removePasskey(passkey.id)}>
                              {t("account.yesRemove")}
                            </Button>
                            <Button isDisabled={busy} onPress={() => setConfirmingId("")}>{t("account.cancel")}</Button>
                          </>
                        ) : (
                          <Button className="passkey-remove" isDisabled={busy} onPress={() => {
                            setEditingId("");
                            setConfirmingId(passkey.id);
                          }}>
                            {t("account.remove")}
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
