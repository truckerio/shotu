const POPUP_VIEWPORT_MARGIN = 16;
const DEFAULT_RESULT_LIMIT = 8;
const MAX_RESULT_LIMIT = 12;

export function catalogSearchPlan({ value, suggestionQuery, resultLimit = DEFAULT_RESULT_LIMIT }) {
  const operatorQuery = String(value || "").trim();
  const automaticQuery = String(suggestionQuery || "").trim();
  return {
    query: automaticQuery.length >= 2 ? automaticQuery : operatorQuery,
    limit: Math.min(MAX_RESULT_LIMIT, Math.max(1, Number.parseInt(resultLimit, 10) || DEFAULT_RESULT_LIMIT)),
  };
}

export function catalogPopupWidth({ anchorLeft, anchorWidth, viewportWidth }) {
  const safeAnchorWidth = Math.max(0, Number(anchorWidth) || 0);
  // A catalog result belongs to its input.  Do not borrow the width of the
  // neighbouring quantity or repair-order fields: that makes the list feel
  // detached from the Part control and can cover the rest of the row.
  const desiredWidth = safeAnchorWidth;
  const availableWidth = Math.max(0, (Number(viewportWidth) || 0) - (Number(anchorLeft) || 0) - POPUP_VIEWPORT_MARGIN);
  return Math.floor(Math.max(0, Math.min(desiredWidth, availableWidth)));
}
