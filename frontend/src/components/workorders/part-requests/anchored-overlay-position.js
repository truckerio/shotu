export function anchoredOverlayShift({
  rect,
  currentShift = { x: 0, y: 0 },
  viewportWidth,
  viewportHeight,
  horizontalInset = 16,
  bottomInset = 16,
}) {
  if (!rect) return currentShift;
  // DOMRect values can contain sub-pixels. Rounding the correction up makes
  // the visual adjustment deterministic instead of feeding tiny transform
  // differences back into a layout-effect state update forever.
  const correction = (value) => Math.ceil(Math.max(0, value));
  return {
    x: correction(rect.right + currentShift.x - viewportWidth + horizontalInset),
    y: correction(rect.bottom + currentShift.y - viewportHeight + bottomInset),
  };
}
