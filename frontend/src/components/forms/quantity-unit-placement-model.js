const MENU_GUTTER = 16;
const MENU_GAP = 6;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function quantityUnitMenuPlacement({
  triggerRect,
  menuHeight,
  viewportHeight,
  viewportOffsetTop = 0,
  isMobile = false,
}) {
  const gutter = MENU_GUTTER;
  const gap = MENU_GAP;
  const top = Number(viewportOffsetTop) || 0;
  const height = Math.max(0, Number(viewportHeight) || 0);
  const bottom = top + height;
  const above = Math.max(0, triggerRect.top - top - gap - gutter);
  const below = Math.max(0, bottom - triggerRect.bottom - gap - gutter);
  const maximumHeight = isMobile ? 420 : 360;
  const usefulHeight = isMobile ? 180 : 240;
  const desiredHeight = Math.min(Math.max(0, Number(menuHeight) || 0), maximumHeight);
  const openBelow = below >= Math.min(desiredHeight, usefulHeight) || below >= above;
  const availableHeight = openBelow ? below : above;
  const boundedHeight = Math.min(maximumHeight, availableHeight);
  const result = {
    placement: openBelow ? "below" : "above",
    maxHeight: Math.floor(Math.max(0, boundedHeight)),
  };
  if (isMobile) {
    const idealTop = openBelow ? triggerRect.bottom + gap : triggerRect.top - gap - result.maxHeight;
    result.top = Math.floor(clamp(idealTop, top + gutter, Math.max(top + gutter, bottom - gutter - result.maxHeight)));
  }
  return result;
}
