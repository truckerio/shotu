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

function passkeyLabel(passkey) {
  return passkey.name?.trim() || "Unnamed passkey";
}

function passkeyDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function errorMessage(action) {
  return `Could not ${action} the passkey. Try again.`;
}

export function PasskeyManager({ isOpen, onOpenChange }) {
  const [passkeys, setPasskeys] = useState([]);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [confirmingId, setConfirmingId] = useState("");
  const [status, setStatus] = useState({ kind: "idle", message: "" });
  const busy = status.kind === "busy";

  async function loadPasskeys() {
    setStatus({ kind: "busy", message: "Loading passkeys..." });
    try {
      const result = await authClient.passkey.listUserPasskeys();
      if (result.error) {
        setStatus({ kind: "error", message: errorMessage("load") });
        return;
      }
      setPasskeys(result.data ?? []);
      setStatus({ kind: "idle", message: "" });
    } catch {
      setStatus({ kind: "error", message: errorMessage("load") });
    }
  }

  useEffect(() => {
    if (isOpen) void loadPasskeys();
  }, [isOpen]);

  async function registerPasskey(event) {
    event.preventDefault();
    setStatus({ kind: "busy", message: "Follow your device prompts..." });
    try {
      const result = await authClient.passkey.addPasskey({
        name: name.trim() || undefined,
      });
      if (result?.error) {
        setStatus({ kind: "error", message: errorMessage("add") });
        return;
      }
      setName("");
      await loadPasskeys();
      setStatus({ kind: "success", message: "Passkey added." });
    } catch {
      setStatus({ kind: "error", message: errorMessage("add") });
    }
  }

  async function renamePasskey(event, id) {
    event.preventDefault();
    const nextName = editingName.trim();
    if (!nextName) return;
    setStatus({ kind: "busy", message: "Renaming passkey..." });
    try {
      const result = await authClient.passkey.updatePasskey({ id, name: nextName });
      if (result.error) {
        setStatus({ kind: "error", message: errorMessage("rename") });
        return;
      }
      setPasskeys((current) => current.map((item) => (
        item.id === id ? { ...item, name: nextName } : item
      )));
      setEditingId("");
      setEditingName("");
      setStatus({ kind: "success", message: "Passkey renamed." });
    } catch {
      setStatus({ kind: "error", message: errorMessage("rename") });
    }
  }

  async function removePasskey(id) {
    setStatus({ kind: "busy", message: "Removing passkey..." });
    try {
      const result = await authClient.passkey.deletePasskey({ id });
      if (result.error) {
        setStatus({ kind: "error", message: errorMessage("remove") });
        return;
      }
      setPasskeys((current) => current.filter((item) => item.id !== id));
      setConfirmingId("");
      setStatus({ kind: "success", message: "Passkey removed." });
    } catch {
      setStatus({ kind: "error", message: errorMessage("remove") });
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
              <Heading id="passkey-dialog-title" slot="title">Passkeys</Heading>
              <p>Use your device, fingerprint, face, or security key to sign in.</p>
            </div>
            <Button
              className="passkey-close"
              aria-label="Close passkey settings"
              isDisabled={busy}
              onPress={() => onOpenChange(false)}
            >
              ×
            </Button>
          </div>

          <form className="passkey-register" onSubmit={registerPasskey}>
            <TextField value={name} onChange={setName}>
              <Label>Passkey name <span>(optional)</span></Label>
              <Input placeholder="Example: Work MacBook" autoComplete="off" />
            </TextField>
            <Button type="submit" isDisabled={busy || !window.PublicKeyCredential}>
              {busy ? "Please wait..." : "Add passkey"}
            </Button>
          </form>

          {!window.PublicKeyCredential ? (
            <p className="passkey-message passkey-message-error" role="alert">
              Passkeys are not available in this browser.
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
            <h3>Your passkeys</h3>
            <Button onPress={loadPasskeys} isDisabled={busy}>Refresh</Button>
          </div>

          {!busy && passkeys.length === 0 ? (
            <p className="passkey-empty">No passkeys added yet.</p>
          ) : (
            <ul className="passkey-list">
              {passkeys.map((passkey) => (
                <li key={passkey.id} className="passkey-item">
                  {editingId === passkey.id ? (
                    <form className="passkey-rename" onSubmit={(event) => renamePasskey(event, passkey.id)}>
                      <TextField
                        aria-label="New passkey name"
                        value={editingName}
                        onChange={setEditingName}
                      >
                        <Input autoFocus />
                      </TextField>
                      <Button type="submit" isDisabled={busy || !editingName.trim()}>Save</Button>
                      <Button type="button" isDisabled={busy} onPress={() => setEditingId("")}>Cancel</Button>
                    </form>
                  ) : (
                    <>
                      <div className="passkey-item-copy">
                        <strong>{passkeyLabel(passkey)}</strong>
                        {passkeyDate(passkey.createdAt) ? <small>Added {passkeyDate(passkey.createdAt)}</small> : null}
                      </div>
                      <div className="passkey-item-actions">
                        <Button
                          isDisabled={busy}
                          onPress={() => {
                            setConfirmingId("");
                            setEditingId(passkey.id);
                            setEditingName(passkeyLabel(passkey));
                          }}
                        >
                          Rename
                        </Button>
                        {confirmingId === passkey.id ? (
                          <>
                            <span>Remove this passkey?</span>
                            <Button className="passkey-remove-confirm" isDisabled={busy} onPress={() => removePasskey(passkey.id)}>
                              Yes, remove
                            </Button>
                            <Button isDisabled={busy} onPress={() => setConfirmingId("")}>Cancel</Button>
                          </>
                        ) : (
                          <Button className="passkey-remove" isDisabled={busy} onPress={() => {
                            setEditingId("");
                            setConfirmingId(passkey.id);
                          }}>
                            Remove
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
