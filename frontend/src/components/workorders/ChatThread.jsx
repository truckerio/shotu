import { useLayoutEffect, useRef } from "react";
import { formatLocaleNumber, interfaceText } from "../../i18n/index.js";
import { formatChatTime } from "../../lib/dates.js";
import { shouldRenderMessageReceipt } from "../../lib/chat-receipts.js";
import { visibleConversationMessages } from "./chat-messages.js";
import {
  isChatNearBottom,
  nextChatScrollTop,
} from "./chat/chat-composer-behavior.js";
import { MessageReceipt } from "./chat/MessageReceipt.jsx";
import "./chat/chat.css";

function getImageAttachments(message, fallbackName) {
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
    : message.attachment
      ? [message.attachment]
      : [];

  return attachments
    .map((attachment, index) => ({
      id: attachment.id || `${message.id}-attachment-${index}`,
      fileName: attachment.fileName || attachment.filename || fallbackName,
      mimeType: attachment.mimeType || attachment.contentType || "",
      source: attachment.dataUrl || attachment.url || attachment.src || "",
    }))
    .filter((attachment) => (
      attachment.source
      && (attachment.mimeType.startsWith("image/") || attachment.source.startsWith("data:image/"))
    ));
}

export function ChatThread({
  messages,
  currentRole = "mechanic",
  currentUserId = "",
  empty,
  locale = "en",
  keyboardOpen = false,
  viewportHeight = 0,
}) {
  const t = (key) => interfaceText(locale, key);
  const visibleMessages = visibleConversationMessages(messages || []);
  const threadRef = useRef(null);
  const nearBottomRef = useRef(true);
  const scrollTopRef = useRef(0);
  const latestMessageId = visibleMessages.at(-1)?.id || "";

  useLayoutEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;

    thread.scrollTop = nextChatScrollTop({
      wasNearBottom: nearBottomRef.current,
      previousScrollTop: scrollTopRef.current,
      scrollHeight: thread.scrollHeight,
      clientHeight: thread.clientHeight,
    });
    scrollTopRef.current = thread.scrollTop;
    nearBottomRef.current = isChatNearBottom(thread);
  }, [keyboardOpen, latestMessageId, viewportHeight]);

  function trackScroll(event) {
    scrollTopRef.current = event.currentTarget.scrollTop;
    nearBottomRef.current = isChatNearBottom(event.currentTarget);
  }

  return (
    <div
      ref={threadRef}
      className={`chat-thread ${visibleMessages.length ? "" : "is-empty"}`.trim()}
      aria-label={t("chat.conversation")}
      aria-live="polite"
      aria-relevant="additions text"
      role="log"
      tabIndex={0}
      onScroll={trackScroll}
    >
      {visibleMessages.length ? visibleMessages.map((message) => {
        const mine = currentUserId
          ? message.senderUserId === currentUserId
          : message.senderRole === currentRole;
        const senderName = mine ? t("chat.you") : message.senderName || message.senderRole || t("chat.office");
        const imageAttachments = getImageAttachments(message, t("photos.workorderPhoto"));
        const requestLabel = message.messageType === "part_request"
          ? t("chat.partRequest")
          : message.messageType === "help_request"
            ? t("chat.helpRequest")
            : "";
        return (
          <div className={`chat-message ${mine ? "from-current-user" : "from-other-user"}`} key={message.id}>
            <div className="chat-message-body">
              <div className="chat-message-meta">
                <strong>{senderName}</strong>
                <span className="chat-message-delivery">
                  {message.createdAt ? <time dateTime={message.createdAt}>{formatChatTime(message.createdAt, locale)}</time> : null}
                  {shouldRenderMessageReceipt({ currentUserId, message })
                    ? <MessageReceipt receipt={message.receipt} locale={locale} />
                    : null}
                </span>
              </div>
              <div className="chat-bubble">
                {requestLabel ? <span className="chat-request-label">{requestLabel}</span> : null}
                {message.body ? <p>{message.body}</p> : null}
                {imageAttachments.length ? (
                  <div className="chat-attachments" aria-label={`${formatLocaleNumber(imageAttachments.length, locale)} ${t(imageAttachments.length === 1 ? "chat.imageAttachment" : "chat.imageAttachments")}`}>
                    {imageAttachments.map((attachment) => (
                      <figure className="chat-image-attachment" key={attachment.id}>
                        <a
                          className="chat-image-link"
                          href={attachment.source}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`${t("chat.openAttachment")}: ${attachment.fileName}`}
                        >
                          <img
                            className="chat-attachment-image"
                            src={attachment.source}
                            alt={`${attachment.fileName} — ${t("chat.attachedBy")} ${senderName}`}
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
      }) : <p className="chat-empty">{empty ?? t("chat.noMessages")}</p>}
    </div>
  );
}
