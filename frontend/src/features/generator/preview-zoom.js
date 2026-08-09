export const PREVIEW_ZOOM_MIN = 0;
export const PREVIEW_ZOOM_MAX = 2;

export function normalizePreviewZoom(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, Math.round(numeric)));
}
