export const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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

export function buildChatPayload(body, attachment) {
  return {
    body: body.trim(),
    attachment: attachment
      ? {
          dataUrl: attachment.dataUrl,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
        }
      : null,
  };
}
