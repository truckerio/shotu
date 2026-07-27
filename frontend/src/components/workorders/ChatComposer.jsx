import { useId, useRef, useState } from "react";
import { ArrowUp, Plus, XClose } from "@untitledui/icons";

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
}) {
  const inputId = useId();
  const fileInputId = useId();
  const fileInputRef = useRef(null);
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
    setAttachment(null);
    setError("");
    clearFileInput();
  }

  async function selectImage(event) {
    const file = event.target.files?.[0];
    setError("");

    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose a photo file such as JPG, PNG, or HEIC.");
      clearFileInput();
      return;
    }
    if (file.size > maxImageBytes) {
      setError("Photo is larger than 10 MB. Choose a smaller photo.");
      clearFileInput();
      return;
    }

    setReadingImage(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
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
      const result = await onSend({
        body: body.trim(),
        attachment: attachment
          ? {
              dataUrl: attachment.dataUrl,
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
            }
          : null,
      });

      if (result === false) return;
      setBody("");
      setAttachment(null);
      clearFileInput();
      if (textareaRef.current) textareaRef.current.style.height = "";
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Message was not sent. Please try again.");
    }
  }

  function handleKeyDown(event) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void sendMessage();
  }

  function updateBody(event) {
    setBody(event.target.value);
    if (!compact) return;
    event.target.style.height = "auto";
    event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
  }

  return (
    <form className={`chat-composer ${compact ? "is-compact" : ""}`} onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
      <label className="chat-composer-label" htmlFor={inputId}>{textareaLabel}</label>
      <textarea
        ref={textareaRef}
        id={inputId}
        className="chat-composer-input"
        rows={compact ? 1 : 3}
        value={body}
        onChange={updateBody}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={busy}
      />

      {attachment ? (
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

      <div className="chat-composer-actions">
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
