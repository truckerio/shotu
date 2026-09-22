import { getUnitDefinition } from "../../../../shared/units-of-measure.js";

const titleCase = (value = "") => value.split("_").filter(Boolean).map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ");

export function transferAllocationMatchesQuantity(allocations = [], quantity, uomCode) {
  const expected = Number(quantity);
  const scale = getUnitDefinition(uomCode)?.decimalScale ?? 0;
  const factor = 10 ** scale;
  if (!allocations.length || !Number.isFinite(expected)) return false;
  const allocatedMinorUnits = allocations.reduce((total, entry) => total + Math.round(Number(entry.quantity || 0) * factor), 0);
  return allocatedMinorUnits === Math.round(expected * factor);
}

export function transferStatus(task = {}) {
  if (task.transfer_state === "returning") return { label: "Returning to source", tone: "attention" };
  if (task.transfer_state === "completed" || task.status === "received") return { label: "Complete", tone: "success" };
  if (task.status === "cancelled") return { label: "Cancelled", tone: "muted" };
  return { label: "In transit", tone: "info" };
}

export function transferNextStep(task = {}, locationId) {
  if (task.status === "cancelled" || task.transfer_state === "completed" || task.status === "received") return "No action needed.";
  if (task.transfer_state === "returning" && task.location_id === locationId) return "Confirm the returned goods at their source bin.";
  if (task.destination_id === locationId) return "Count or scan what arrived, then put away the good goods.";
  if (task.location_id === locationId) return "Track the handoff, or start a physical return for goods still in transit.";
  return "Open this transfer from the source or destination shop.";
}

export function transferDispatchPayload({ locationId, catalogPartId, quantity, expectedBalanceRevision, destinationId, reason, holder, serialNumbers = [], sourceAllocations = [], blindReceiving = false }) {
  return { action: "transfer", locationId, catalogPartId, quantity: Number(quantity), expectedBalanceRevision, destinationId, reason, holder, serialNumbers, sourceAllocations, blindReceiving };
}

export function transferReceiptPayload({ task, locationId, quantity, reason, holder, serialNumbers = [], targetPositionId, disposition = "good" }) {
  return { action: "receive_transfer", taskId: task.id, locationId, expectedVersion: task.version, quantity: Number(quantity), reason, holder, serialNumbers, targetPositionId, disposition };
}

export function transferDiscrepancyPayload({ task, locationId, discrepancyType, quantity, reason, holder, serialNumbers = [], targetPositionId }) {
  return { action: "report_transfer_discrepancy", taskId: task.id, locationId, expectedVersion: task.version, discrepancyType, quantity: Number(quantity), reason, holder, serialNumbers, ...(targetPositionId ? { targetPositionId } : {}) };
}

export function transferReturnPayload({ task, locationId, reason, holder, action = "request_transfer_return", quantity, serialNumbers = [], targetPositionId }) {
  return { action, taskId: task.id, locationId, expectedVersion: task.version, reason, holder, ...(quantity !== undefined ? { quantity: Number(quantity) } : {}), ...(serialNumbers.length ? { serialNumbers } : {}), ...(targetPositionId ? { targetPositionId } : {}) };
}

export function transferEventLabel(event = {}) {
  return titleCase(event.action || "updated");
}
