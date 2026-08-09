import { useId, useRef, useState } from "react";
import { ArrowUp, Plus, XClose } from "@untitledui/icons";
import { NarrativeField } from "../forms/NarrativeField.jsx";
import {
  buildChatPayload,
  createClientMessageId,
  getImageValidationError,
  shouldSubmitChatKey,
} from "./chat/chat-composer-behavior.js";
import "./chat/chat.css";

const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result), { once: true });
    reader.addEventListener("error", () => reject(new Error("The photo could not be read. Please try again.")), { once: true });
    reader.readAsDataURL(file);
  });
}

export function ChatComposer({
  onSend,
  disabled = false,
  sending = false,
  placeholder = "Write a message...",
  textareaLabel = "Message",
  cameraLabel = "Take or add photo",
  sendLabel = "Send message",
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  compact = false,
  quickActions = [],
  allowAttachments = true,
}) {
  const inputId = useId();
  const fileInputId = useId();
  const fileInputRef = useRef(null);
  const pendingClientMessageIdRef = useRef("");
  const textareaRef = useRef(null);
  const [body, setBody] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [readingImage, setReadingImage] = useState(false);
  const [error, setError] = useState("");

  const busy = disabled || sending || readingImage;
  const canSend = !busy && Boolean(body.trim() || attachment);

  function clearFileInput() {
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment() {
    pendingClientMessageIdRef.current = "";
    setAttachment(null);
    setError("");
    clearFileInput();
  }

  async function selectImage(event) {
    const file = event.target.files?.[0];
    setError("");

    if (!file) return;
    const validationError = getImageValidationError(file, maxImageBytes);
    if (validationError) {
      setError(validationError);
      clearFileInput();
      return;
    }

    setReadingImage(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      pendingClientMessageIdRef.current = "";
      setAttachment({ dataUrl, fileName: file.name, mimeType: file.type });
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "The photo could not be read. Please try again.");
      clearFileInput();
    } finally {
      setReadingImage(false);
    }
  }

  async function sendMessage() {
    if (!canSend || typeof onSend !== "function") return;

    setError("");
    try {
      const clientMessageId = pendingClientMessageIdRef.current || createClientMessageId();
      pendingClientMessageIdRef.current = clientMessageId;
      const result = await onSend(buildChatPayload(body, attachment, clientMessageId));

      if (result === false) return;
      pendingClientMessageIdRef.current = "";
      setBody("");
      setAttachment(null);
      clearFileInput();
      if (textareaRef.current) textareaRef.current.style.height = "";
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Message was not sent. Please try again.");
    }
  }

  function handleKeyDown(event) {
    if (!shouldSubmitChatKey(event)) return;
    event.preventDefault();
    void sendMessage();
  }

  function updateBody(event) {
    pendingClientMessageIdRef.current = "";
    setBody(event.target.value);
    event.target.style.height = "auto";
    event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
  }

  function useQuickAction(action) {
    if (busy) return;
    if (action.kind === "photo") {
      if (!allowAttachments) return;
      fileInputRef.current?.click();
      return;
    }
    pendingClientMessageIdRef.current = "";
    setBody(action.prompt || "");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <form className={`chat-composer chat-prompt-composer ${compact ? "is-compact" : ""}`} onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
      <label className="chat-composer-label" htmlFor={inputId}>{textareaLabel}</label>

      {allowAttachments && attachment ? (
        <figure className="chat-composer-preview">
          <img
            className="chat-composer-preview-image"
            src={attachment.dataUrl}
            alt={`Selected photo: ${attachment.fileName}`}
          />
          <figcaption className="chat-composer-preview-details">
            <span className="chat-composer-preview-name">{attachment.fileName}</span>
            <button className="chat-composer-remove" type="button" onClick={removeAttachment} disabled={busy}>
              <XClose aria-hidden="true" />
              <span>Remove photo</span>
            </button>
          </figcaption>
        </figure>
      ) : null}

      {error ? <p className="chat-composer-error" role="alert">{error}</p> : null}

      {quickActions.length ? (
        <div className="chat-quick-actions" aria-label="Help actions">
          {quickActions.map((action) => (
            <button key={action.id} type="button" onClick={() => useQuickAction(action)} disabled={busy}>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="chat-prompt-surface">
        {allowAttachments ? (
          <>
            <input
              ref={fileInputRef}
              id={fileInputId}
              className="chat-composer-file-input"
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={selectImage}
              disabled={busy}
              tabIndex={-1}
              aria-hidden="true"
            />
            <label
              className={`chat-camera-button ${busy ? "is-disabled" : ""}`}
              htmlFor={fileInputId}
              role="button"
              tabIndex={busy ? -1 : 0}
              onClick={(event) => {
                if (busy) event.preventDefault();
              }}
              onKeyDown={(event) => {
                if (busy || !["Enter", " "].includes(event.key)) return;
                event.preventDefault();
                fileInputRef.current?.click();
              }}
              aria-disabled={busy || undefined}
              aria-label={readingImage ? "Loading photo" : cameraLabel}
              title={readingImage ? "Loading photo" : cameraLabel}
            >
              <Plus aria-hidden="true" />
            </label>
          </>
        ) : null}
        <NarrativeField
          ref={textareaRef}
          id={inputId}
          className="chat-composer-input"
          rows={1}
          value={body}
          onChange={updateBody}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={busy}
          enterKeyHint="send"
        />
        <button
          className="chat-send-button"
          type="submit"
          disabled={!canSend}
          aria-label={sending ? "Sending message" : sendLabel}
          title={sending ? "Sending message" : sendLabel}
        >
          <ArrowUp aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
