import { useState } from "react";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { formatLocaleNumber, interfaceText } from "../../../i18n/index.js";
import "./workorder-photos.css";

function imageAttachments(messages = [], fallbackName = "Workorder photo") {
  return messages.flatMap((message) => {
    const attachments = Array.isArray(message.attachments) ? message.attachments : message.attachment ? [message.attachment] : [];
    return attachments.flatMap((attachment, index) => {
      const source = attachment.dataUrl || attachment.url || attachment.src || "";
      const mimeType = attachment.mimeType || attachment.contentType || "";
      if (!source || (!mimeType.startsWith("image/") && !source.startsWith("data:image/"))) return [];
      return [{
        id: attachment.id || `${message.id}-photo-${index}`,
        name: attachment.fileName || attachment.filename || fallbackName,
        source,
      }];
    });
  });
}

function WorkorderPhoto({ photo, t }) {
  const [unavailable, setUnavailable] = useState(false);

  return (
    <figure className="workorder-photo-card">
      {unavailable ? (
        <div className="workorder-photo-unavailable" role="img" aria-label={`${photo.name}: ${t("photos.unavailable")} `}>
          <span>{t("photos.unavailable")}</span>
          <small>{t("photos.uploadAgain")}</small>
        </div>
      ) : (
        <a
          className="workorder-photo-link"
          href={photo.source}
          target="_blank"
          rel="noreferrer"
          aria-label={`${t("photos.open")}: ${photo.name}`}
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

export function WorkorderPhotosModule({ access, activeSection, messages, onSelect, locale = "en" }) {
  if (!access) return null;
  const t = (key) => interfaceText(locale, key);
  const photos = imageAttachments(messages, t("photos.workorderPhoto"));
  return (
    <ProgressiveWorkorderSection id="photos" title={t("photos.title")} summary={photos.length ? `${formatLocaleNumber(photos.length, locale)} ${t("photos.attached")}` : t("photos.none")} activeSection={activeSection} onSelect={onSelect} displayMode="panel">
      {photos.length ? (
        <div className="workorder-photo-grid" aria-label={t("photos.list")}>
          {photos.map((photo) => (
            <WorkorderPhoto photo={photo} t={t} key={photo.id} />
          ))}
        </div>
      ) : null}
    </ProgressiveWorkorderSection>
  );
}
