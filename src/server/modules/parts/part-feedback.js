const DECISION_LABELS = {
  approved: "approved",
  needs_info: "needs more information for",
  rejected: "declined",
};

const SOURCE_LABELS = {
  inventory: "inventory",
  purchase: "purchase",
  transfer: "transfer",
  customer_supplied: "customer supplied",
  mechanic_supplied: "mechanic supplied",
  unknown: "supply not selected",
};

function sentence(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function titleCase(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function partRequestLabel(request) {
  return request.part_number || request.partNumber
    || request.description
    || request.raw_query || request.rawQuery
    || "requested part";
}

export function formatPartDecisionFeedback({ decision, quantity, label, reason, allocations = [] }) {
  const action = DECISION_LABELS[decision] || decision;
  const quantityLabel = quantity ? `${quantity} x ` : "";
  const supply = decision === "approved" && allocations.length
    ? ` Supply: ${allocations.map((allocation) => (
      `${SOURCE_LABELS[allocation.sourceType] || allocation.sourceType} (${titleCase(allocation.status)})`
    )).join(", ")}.`
    : "";
  const note = reason ? ` ${sentence(reason)}` : "";
  return `Office ${action} ${quantityLabel}${label}.${supply}${note}`.replace("..", ".");
}

export function formatAllocationFeedback({ quantity, label, sourceType, status, note }) {
  const source = SOURCE_LABELS[sourceType] || sourceType;
  const detail = note ? ` ${sentence(note)}` : "";
  return `Part update: ${quantity} x ${label} from ${source} is now ${titleCase(status)}.${detail}`.replace("..", ".");
}

export function formatUsageFeedback({ quantity, label, usageStatus, note }) {
  const detail = note ? ` ${sentence(note)}` : "";
  return `Mechanic marked ${quantity} x ${label} as ${titleCase(usageStatus)}.${detail}`.replace("..", ".");
}
