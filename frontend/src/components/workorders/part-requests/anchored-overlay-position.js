export function anchoredOverlayShift({
  rect,
  currentShift = { x: 0, y: 0 },
  viewportWidth,
  viewportHeight,
  horizontalInset = 16,
  bottomInset = 16,
}) {
  if (!rect) return currentShift;
  return {
    x: Math.max(0, rect.right + currentShift.x - viewportWidth + horizontalInset),
    y: Math.max(0, rect.bottom + currentShift.y - viewportHeight + bottomInset),
  };
}
