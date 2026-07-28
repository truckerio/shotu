import { quantityLabel } from "./quantity-uom.js";

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

export function formatPartDecisionFeedback({ decision, quantity, uomCode, label, reason, allocations = [] }) {
  const action = DECISION_LABELS[decision] || decision;
  const amount = quantity ? `${quantityLabel(quantity, uomCode)} ` : "";
  const supply = decision === "approved" && allocations.length
    ? ` Supply: ${allocations.map((allocation) => (
      `${SOURCE_LABELS[allocation.sourceType] || allocation.sourceType} (${titleCase(allocation.status)})`
    )).join(", ")}.`
    : "";
  const note = reason ? ` ${sentence(reason)}` : "";
  return `Office ${action} ${amount}${label}.${supply}${note}`.replace("..", ".");
}

export function formatAllocationFeedback({ quantity, uomCode, label, sourceType, status, note }) {
  const source = SOURCE_LABELS[sourceType] || sourceType;
  const detail = note ? ` ${sentence(note)}` : "";
  return `Part update: ${quantityLabel(quantity, uomCode)} ${label} from ${source} is now ${titleCase(status)}.${detail}`.replace("..", ".");
}

export function formatUsageFeedback({ quantity, uomCode, label, usageStatus, note }) {
  const detail = note ? ` ${sentence(note)}` : "";
  return `Mechanic marked ${quantityLabel(quantity, uomCode)} ${label} as ${titleCase(usageStatus)}.${detail}`.replace("..", ".");
}
