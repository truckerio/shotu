export const INSPECTION_STATUS = Object.freeze({
  REQUESTED: "requested", ASSIGNED: "assigned", IN_PROGRESS: "in_progress", COMPLETED: "completed", CANCELLED: "cancelled",
});
export const INSPECTION_RESPONSES = Object.freeze(["pass", "issue", "na"]);
export const INSPECTION_SEVERITIES = Object.freeze(["attention", "repair_required", "out_of_service"]);
export const INSPECTION_DISPOSITIONS = Object.freeze(["new_workorder", "linked_workorder", "office_follow_up", "no_workorder"]);
