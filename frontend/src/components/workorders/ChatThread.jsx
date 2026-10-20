import { useLayoutEffect, useRef, useState } from "react";
import { formatLocaleNumber, interfaceText } from "../../i18n/index.js";
import { formatChatTime } from "../../lib/dates.js";
import { shouldRenderMessageReceipt } from "../../lib/chat-receipts.js";
import { visibleConversationMessages } from "./chat-messages.js";
import {
  isChatNearBottom,
  nextChatScrollTop,
} from "./chat/chat-composer-behavior.js";
import { MessageReceipt } from "./chat/MessageReceipt.jsx";
import { getImageAttachments } from "./chat/chat-photo-filter.js";
import "./chat/chat.css";

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
  const allVisibleMessages = visibleConversationMessages(messages || []);
  const [filter, setFilter] = useState("all");
  const photoCount = allVisibleMessages.filter((message) => getImageAttachments(message).length > 0).length;
  const visibleMessages = filter === "photos"
    ? allVisibleMessages.filter((message) => getImageAttachments(message).length > 0)
    : allVisibleMessages;
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
    <div className="chat-thread-surface">
      {photoCount ? <div className="chat-thread-filters" aria-label="Filter chat messages">
        <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
        <button type="button" aria-pressed={filter === "photos"} onClick={() => setFilter("photos")}>Photos <span>{formatLocaleNumber(photoCount, locale)}</span></button>
      </div> : null}
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
      }) : <p className="chat-empty">{filter === "photos" ? "No photos in this chat." : empty ?? t("chat.noMessages")}</p>}
      </div>
    </div>
  );
}
