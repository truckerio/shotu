export const DOCUMENT_ZOOM_MIN = 0.5;
export const DOCUMENT_ZOOM_MAX = 2;
export const DOCUMENT_ZOOM_STEP = 0.25;

export function clampDocumentZoom(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(DOCUMENT_ZOOM_MAX, Math.max(DOCUMENT_ZOOM_MIN, number));
}

export function changeDocumentZoom(current, direction) {
  const delta = direction === "out" ? -DOCUMENT_ZOOM_STEP : DOCUMENT_ZOOM_STEP;
  return clampDocumentZoom(clampDocumentZoom(current) + delta);
}

export function nextDocumentRotation(current) {
  const normalized = Number.isFinite(Number(current)) ? Number(current) : 0;
  return ((normalized + 90) % 360 + 360) % 360;
}

export function documentRotationTransform(rotation) {
  const normalized = ((Number(rotation) % 360) + 360) % 360;
  if (normalized === 90) return "rotate(90deg) translateY(-100%)";
  if (normalized === 180) return "rotate(180deg) translate(-100%, -100%)";
  if (normalized === 270) return "rotate(270deg) translateX(-100%)";
  return "rotate(0deg)";
}

export function documentZoomLabel(zoom) {
  return `${Math.round(clampDocumentZoom(zoom) * 100)}%`;
}
