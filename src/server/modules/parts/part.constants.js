export const PART_APPROVAL_STATUS = {
  SUBMITTED: "submitted",
  NEEDS_INFO: "needs_info",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
};

export const PART_SOURCE_TYPES = [
  "inventory",
  "purchase",
  "transfer",
  "customer_supplied",
  "mechanic_supplied",
  "unknown",
];

export const PART_ALLOCATION_STATUSES = [
  "proposed",
  "reserved",
  "issued",
  "ordered",
  "received",
  "transferred",
  "installed",
  "returned",
  "cancelled",
];

export const PART_ALLOCATION_INITIAL_STATUSES = Object.freeze({
  inventory: Object.freeze(["proposed", "reserved"]),
  purchase: Object.freeze(["proposed", "ordered", "received"]),
  transfer: Object.freeze(["proposed", "transferred"]),
  customer_supplied: Object.freeze(["proposed", "received"]),
  mechanic_supplied: Object.freeze(["proposed", "received"]),
  unknown: Object.freeze(["proposed"]),
});

export function isValidInitialAllocationStatus(sourceType, status) {
  return PART_ALLOCATION_INITIAL_STATUSES[sourceType]?.includes(status) === true;
}

export const PART_USAGE_STATUSES = [
  "not_issued",
  "issued",
  "partially_installed",
  "installed",
  "not_used",
  "returned",
  "damaged",
];

export function normalizePartNumber(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
