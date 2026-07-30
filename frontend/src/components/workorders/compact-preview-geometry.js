const WORKORDER_DOCUMENT_WIDTH_PX = 1056;

export function compactPreviewDocumentScale(width) {
  const safeWidth = Number(width);
  return Number.isFinite(safeWidth) && safeWidth > 0
    ? safeWidth / WORKORDER_DOCUMENT_WIDTH_PX
    : 1;
}
