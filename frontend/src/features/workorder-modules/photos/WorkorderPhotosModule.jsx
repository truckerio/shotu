import { useState } from "react";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import "./workorder-photos.css";

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

function WorkorderPhoto({ photo }) {
  const [unavailable, setUnavailable] = useState(false);

  return (
    <figure className="workorder-photo-card">
      {unavailable ? (
        <div className="workorder-photo-unavailable" role="img" aria-label={`${photo.name} is unavailable`}>
          <span>Image unavailable</span>
          <small>Upload this photo again to restore it.</small>
        </div>
      ) : (
        <a
          className="workorder-photo-link"
          href={photo.source}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${photo.name}`}
        >
          <img
            className="workorder-photo-image"
            src={photo.source}
            alt={photo.name}
            loading="lazy"
            onError={() => setUnavailable(true)}
          />
        </a>
      )}
      <figcaption className="workorder-photo-name" title={photo.name}>{photo.name}</figcaption>
    </figure>
  );
}

export function WorkorderPhotosModule({ access, activeSection, messages, onSelect }) {
  if (!access) return null;
  const photos = imageAttachments(messages);
  return (
    <ProgressiveWorkorderSection id="photos" title="Photos" summary={photos.length ? `${photos.length} attached` : "No photos"} activeSection={activeSection} onSelect={onSelect} displayMode="panel">
      {photos.length ? (
        <div className="workorder-photo-grid" aria-label="Workorder photos">
          {photos.map((photo) => (
            <WorkorderPhoto photo={photo} key={photo.id} />
          ))}
        </div>
      ) : <p>No photos attached to this workorder.</p>}
    </ProgressiveWorkorderSection>
  );
}
