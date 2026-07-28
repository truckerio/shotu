export const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const CHAT_BOTTOM_THRESHOLD_PX = 80;

export function getImageValidationError(file, maxImageBytes = DEFAULT_MAX_IMAGE_BYTES) {
  if (!file?.type?.startsWith("image/")) {
    return "Choose a photo file such as JPG, PNG, or HEIC.";
  }
  if (file.size > maxImageBytes) {
    return "Photo is larger than 10 MB. Choose a smaller photo.";
  }
  return "";
}

export function shouldSubmitChatKey(event) {
  return event.key === "Enter"
    && !event.shiftKey
    && !event.nativeEvent?.isComposing;
}

export function isChatNearBottom(metrics, threshold = CHAT_BOTTOM_THRESHOLD_PX) {
  const scrollHeight = Number(metrics?.scrollHeight) || 0;
  const scrollTop = Number(metrics?.scrollTop) || 0;
  const clientHeight = Number(metrics?.clientHeight) || 0;
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

export function nextChatScrollTop({
  wasNearBottom,
  previousScrollTop,
  scrollHeight,
  clientHeight,
}) {
  if (wasNearBottom) {
    return Math.max(0, (Number(scrollHeight) || 0) - (Number(clientHeight) || 0));
  }
  return Math.max(0, Number(previousScrollTop) || 0);
}

export function createClientMessageId(randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)) {
  if (typeof randomUUID !== "function") {
    throw new Error("This browser cannot create a message identity. Refresh and try again.");
  }
  return randomUUID();
}

export function buildChatPayload(body, attachment, clientMessageId) {
  return {
    body: body.trim(),
    clientMessageId,
    attachment: attachment
      ? {
          dataUrl: attachment.dataUrl,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
        }
      : null,
  };
}
