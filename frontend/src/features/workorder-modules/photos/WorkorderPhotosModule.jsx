import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";

function imageAttachments(messages = []) {
  return messages.flatMap((message) => {
    const attachments = Array.isArray(message.attachments) ? message.attachments : message.attachment ? [message.attachment] : [];
    return attachments.flatMap((attachment, index) => {
      const source = attachment.dataUrl || attachment.url || attachment.src || "";
      const mimeType = attachment.mimeType || attachment.contentType || "";
      if (!source || (!mimeType.startsWith("image/") && !source.startsWith("data:image/"))) return [];
      return [{
        id: attachment.id || `${message.id}-photo-${index}`,
        name: attachment.fileName || attachment.filename || "Workorder photo",
        source,
      }];
    });
  });
}

export function WorkorderPhotosModule({ access, activeSection, messages, onSelect }) {
  if (!access) return null;
  const photos = imageAttachments(messages);
  return (
    <ProgressiveWorkorderSection id="photos" title="Photos" summary={photos.length ? `${photos.length} attached` : "No photos"} activeSection={activeSection} onSelect={onSelect} displayMode="panel">
      {photos.length ? (
        <div className="chat-attachments" aria-label="Workorder photos">
          {photos.map((photo) => (
            <figure className="chat-image-attachment" key={photo.id}>
              <a className="chat-image-link" href={photo.source} target="_blank" rel="noreferrer"><img className="chat-attachment-image" src={photo.source} alt={photo.name} loading="lazy" /></a>
              <figcaption className="chat-attachment-name">{photo.name}</figcaption>
            </figure>
          ))}
        </div>
      ) : <p>No photos attached to this workorder.</p>}
    </ProgressiveWorkorderSection>
  );
}
