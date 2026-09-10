const GAP = 6;
const INSET = 16;

export function serializedPickerMaxHeight({ viewportWidth, viewportHeight }) {
  const height = Math.max(0, Number(viewportHeight) || 0);
  const width = Math.max(0, Number(viewportWidth) || 0);
  if (width <= 640) return Math.floor(Math.min(384, Math.max(0, height - 144)));
  if (width <= 1024) return Math.floor(Math.min(448, height * 0.58));
  return Math.floor(Math.min(544, Math.max(0, height - 32)));
}

export function serializedPickerPlacement({ anchorRect, pickerHeight, viewportHeight, viewportOffsetTop = 0 }) {
  const viewportTop = Number(viewportOffsetTop) || 0;
  const viewportBottom = viewportTop + Math.max(0, Number(viewportHeight) || 0);
  const availableAbove = Math.max(0, anchorRect.top - viewportTop - GAP - INSET);
  const availableBelow = Math.max(0, viewportBottom - anchorRect.bottom - GAP - INSET);
  const desiredHeight = Math.max(0, Number(pickerHeight) || 0);
  const side = availableBelow >= desiredHeight || availableBelow >= availableAbove ? "below" : "above";
  const availableHeight = side === "below" ? availableBelow : availableAbove;
  return {
    side,
    maxHeight: Math.floor(Math.min(desiredHeight, availableHeight)),
  };
}
