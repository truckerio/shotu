export function getImageAttachments(message, fallbackName = "Workorder photo") {
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
