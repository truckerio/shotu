const POPUP_VIEWPORT_MARGIN = 16;

export function catalogPopupWidth({ anchorLeft, anchorWidth, rowEnd, viewportWidth }) {
  const safeAnchorWidth = Math.max(0, Number(anchorWidth) || 0);
  const desiredWidth = Math.max(safeAnchorWidth, (Number(rowEnd) || 0) - (Number(anchorLeft) || 0));
  const availableWidth = Math.max(0, (Number(viewportWidth) || 0) - (Number(anchorLeft) || 0) - POPUP_VIEWPORT_MARGIN);
  return Math.floor(Math.max(0, Math.min(desiredWidth, availableWidth)));
}
