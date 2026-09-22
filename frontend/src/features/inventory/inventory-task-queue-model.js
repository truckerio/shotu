export const INVENTORY_TASK_VIEWS = [
  { id: "my_work", label: "My work" },
  { id: "all", label: "All work" },
];

export const INVENTORY_TASK_SOURCES = [
  { id: "", label: "All task types" },
  { id: "damage_inspection", label: "Damage and inspection" },
  { id: "receipt_exception", label: "Receipt exceptions" },
  { id: "missing_invoice", label: "Missing invoices" },
  { id: "invoice_po_decision", label: "Invoice and PO decisions" },
  { id: "no_po_approval", label: "No-PO approvals" },
  { id: "transfer_receipt", label: "Transfer receipts" },
  { id: "position_recount", label: "Position recounts" },
  { id: "removed_part_custody", label: "Removed-part custody" },
];

export function inventoryTaskQueueUrl({ view = "my_work", locationId = "", sourceType = "", search = "", page = 1 }) {
  const params = new URLSearchParams({ view, page: String(page) });
  if (locationId) params.set("locationId", locationId);
  if (sourceType) params.set("sourceType", sourceType);
  if (search.trim()) params.set("search", search.trim());
  return `/api/office/inventory/task-queue?${params}`;
}

export function inventoryTaskDetailUrl(task) {
  const sourceType = encodeURIComponent(task.sourceType);
  const sourceId = encodeURIComponent(task.sourceId);
  return `/api/office/inventory/task-queue/${sourceType}/${sourceId}?locationId=${encodeURIComponent(task.location?.id || task.actionTarget?.locationId || "")}`;
}

export function taskAgeLabel(ageSeconds) {
  const seconds = Math.max(0, Number(ageSeconds) || 0);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d` : `${Math.floor(days / 30)}mo`;
}

export function taskOwnerLabel(task) {
  if (task.assignedUser?.displayName) return task.assignedUser.displayName;
  const role = { admin: "Admin", office: "Office", mechanic: "Mechanic", surveillance: "Surveillance" }[task.owner?.role || task.role];
  return role ? `${role} team` : "Available team";
}

export function taskSelectionFromSearch(params = new URLSearchParams()) {
  const sourceType = params.get("queueTaskType") || "";
  const sourceId = params.get("queueTaskId") || "";
  const locationId = params.get("queueTaskLocation") || "";
  return sourceType && sourceId && locationId ? { sourceType, sourceId, location: { id: locationId } } : null;
}

export function taskSelectionUrl(task = null) {
  const url = new URL(window.location.href);
  for (const key of ["queueTaskType", "queueTaskId", "queueTaskLocation"]) url.searchParams.delete(key);
  if (task) {
    url.searchParams.set("inventorySection", "tasks");
    url.searchParams.set("queueTaskType", task.sourceType);
    url.searchParams.set("queueTaskId", task.sourceId);
    url.searchParams.set("queueTaskLocation", task.location?.id || task.actionTarget?.locationId || "");
  }
  return url;
}

export function taskAssignmentBody(task, action, idempotencyKey) {
  return {
    action,
    locationId: task.location.id,
    sourceType: task.sourceType,
    sourceId: task.sourceId,
    sourceVersion: task.sourceVersion,
    expectedAssignmentVersion: task.assignmentVersion,
    idempotencyKey,
    reason: action === "claim" ? "Claimed from Inventory Tasks" : "Returned to shared Inventory work",
  };
}

export function isRecoverableTaskError(error) {
  return [
    "INVENTORY_TASK_SOURCE_STALE",
    "INVENTORY_TASK_ASSIGNMENT_STALE",
    "INVENTORY_TASK_ALREADY_ASSIGNED",
  ].includes(error?.code);
}

export function recoveredTaskFeedback() {
  return { error: "", notice: "Task refreshed. Review the current owner and action." };
}
