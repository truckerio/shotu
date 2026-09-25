import { formatLocaleNumber } from "../../i18n/index.js";
import { humanizeStatus } from "../../components/workorders/workorder-timeline-model.js";

const ACTION_LABELS = {
  accepted: "Workorder accepted",
  assigned: "Mechanic assigned",
  cancelled: "Cancelled",
  completed: "Completed",
  consumed: "Part consumed",
  created: "Created",
  in_progress: "Work started",
  installed: "Part installed",
  installed_pending_approval: "Part installed — awaiting approval",
  opened: "Needs attention",
  reassigned: "Mechanic reassigned",
  released: "Assignment released",
  removed: "Part removed",
  resolved: "Attention resolved",
  returned: "Part returned",
  submitted: "Submitted",
  unassigned: "Returned to available queue",
  updated: "Updated",
};

function words(value, fallback = "Updated") {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return fallback;
  return ACTION_LABELS[key] || key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function signedQuantity(value, uomCode, locale) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const sign = number > 0 ? "+" : number < 0 ? "−" : "";
  return `${sign}${formatLocaleNumber(Math.abs(number), locale)} ${uomCode || ""}`.trim();
}

function activityTitle(event, locale) {
  if (event.source === "inventory_movement") return Number(event.quantityDelta) >= 0 ? "Inventory added" : "Inventory removed";
  if (event.source === "inventory_unit") return words(event.action, "Serialized part updated");
  if (event.source === "part_created") return "Inventory part created";
  if (event.source === "part_edited") return "Inventory part updated";
  if (event.source === "workorder_created") return "Workorder created";
  if (event.source === "workorder_status") return humanizeStatus(event.action, locale) || "Workorder updated";
  if (event.source === "workorder_field") {
    if (event.action === "work_details_updated") return "Work details updated";
    return `${event.description || words(event.action, "Workorder field")} updated`;
  }
  if (event.source === "workorder_part") return words(event.action, "Workorder part updated");
  if (event.source === "workorder_attention") return words(event.action, "Workorder attention updated");
  if (event.source === "workorder_assignment") return words(event.action, "Assignment updated");
  if (event.source === "inspection_event") return `Inspection ${words(event.action).toLowerCase()}`;
  return words(event.action);
}

function activityDescription(event) {
  if (event.source === "inventory_movement") {
    const reason = String(event.description || "").trim();
    return reason || `${event.partNumber || "Part"} stock changed.`;
  }
  if (event.description) return event.description;
  if (event.partNumber) return event.partNumber;
  return "Activity recorded.";
}

export function userActivityTimelineItem(event, locale = "en") {
  const details = [];
  if (event.partNumber) details.push({ label: "Part", value: event.partNumber });
  if (event.quantityDelta != null) details.push({ label: "Quantity", value: signedQuantity(event.quantityDelta, event.uomCode, locale) });
  if (event.locationName) details.push({ label: "Location", value: event.locationName });
  if (event.workorderSerial) details.push({ label: "Workorder", value: event.workorderSerial });
  if (!event.workorderSerial && event.recordLabel && !event.partNumber) {
    details.push({ label: event.category === "inspections" ? "Inspection" : "Record", value: event.recordLabel });
  }
  return {
    id: event.id,
    actorName: event.actorName,
    actorRole: event.actorRole,
    createdAt: event.createdAt,
    title: activityTitle(event, locale),
    description: activityDescription(event),
    details,
    event: { changed_by_name: event.actorName, actor_role: event.actorRole },
  };
}

export function beginUserActivityLoad(current) {
  return {
    ...current,
    page: 1,
    loading: true,
    loadingMore: false,
    error: "",
  };
}

export const USER_ACTIVITY_CATEGORIES = [
  { value: "", label: "All activity" },
  { value: "workorders", label: "Workorders" },
  { value: "inventory", label: "Inventory" },
  { value: "parts", label: "Parts" },
  { value: "inspections", label: "Inspections" },
];
