import { formatChatTime } from "../../lib/dates.js";
import { visibleConversationMessages } from "./chat-messages.js";
import "./chat/chat.css";

function getImageAttachments(message) {
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
    : message.attachment
      ? [message.attachment]
      : [];

  return attachments
    .map((attachment, index) => ({
      id: attachment.id || `${message.id}-attachment-${index}`,
      fileName: attachment.fileName || attachment.filename || "Workorder photo",
      mimeType: attachment.mimeType || attachment.contentType || "",
      source: attachment.dataUrl || attachment.url || attachment.src || "",
    }))
    .filter((attachment) => (
      attachment.source
      && (attachment.mimeType.startsWith("image/") || attachment.source.startsWith("data:image/"))
    ));
}

export function ChatThread({ messages, currentRole = "mechanic", currentUserId = "", empty = "No messages yet." }) {
  const visibleMessages = visibleConversationMessages(messages || []);
  return (
    <div
      className={`chat-thread ${visibleMessages.length ? "" : "is-empty"}`.trim()}
      aria-label="Conversation"
      aria-live="polite"
      role="log"
      tabIndex={0}
    >
      {visibleMessages.length ? visibleMessages.map((message) => {
        const mine = currentUserId
          ? message.senderUserId === currentUserId
          : message.senderRole === currentRole;
        const senderName = mine ? "You" : message.senderName || message.senderRole || "Office";
        const imageAttachments = getImageAttachments(message);
        const requestLabel = message.messageType === "part_request"
          ? "Part request"
          : message.messageType === "help_request"
            ? "Help request"
            : "";
        return (
          <div className={`chat-message ${mine ? "from-current-user" : "from-other-user"}`} key={message.id}>
            <div className="chat-message-body">
              <div className="chat-message-meta">
                <strong>{senderName}</strong>
                {message.createdAt ? <time dateTime={message.createdAt}>{formatChatTime(message.createdAt)}</time> : null}
              </div>
              <div className="chat-bubble">
                {requestLabel ? <span className="chat-request-label">{requestLabel}</span> : null}
                {message.body ? <p>{message.body}</p> : null}
                {imageAttachments.length ? (
                  <div className="chat-attachments" aria-label={`${imageAttachments.length} image attachment${imageAttachments.length === 1 ? "" : "s"}`}>
                    {imageAttachments.map((attachment) => (
                      <figure className="chat-image-attachment" key={attachment.id}>
                        <a
                          className="chat-image-link"
                          href={attachment.source}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${attachment.fileName}`}
                        >
                          <img
                            className="chat-attachment-image"
                            src={attachment.source}
                            alt={`${attachment.fileName} attached by ${senderName}`}
                            loading="lazy"
                          />
                        </a>
                        <figcaption className="chat-attachment-name">{attachment.fileName}</figcaption>
                      </figure>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      }) : <p className="chat-empty">{empty}</p>}
    </div>
  );
}
