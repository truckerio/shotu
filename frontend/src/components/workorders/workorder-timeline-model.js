import { formatQuantity } from "../../../../shared/units-of-measure.js";
import { interfaceText } from "../../i18n/index.js";

const STATUS_KEYS = {
  created: "timeline.status.created", pending: "timeline.status.pending", submitted: "timeline.status.submitted",
  assigned: "timeline.status.assigned", accepted: "timeline.status.accepted", in_progress: "timeline.status.inProgress",
  parts_requested: "timeline.status.partsRequested", waiting_office: "timeline.status.waitingOffice",
  mechanic_done: "timeline.status.workCompleted", completed: "timeline.status.completed", cancelled: "timeline.status.cancelled",
};

const ACTIVITY_GROUP_WINDOW_MS = 2 * 60 * 1000;

const SERIALIZED_PART_ACTIONS = {
  reserved: { title: "timeline.partReserved", description: "timeline.partReservedDescription" },
  installed_pending_approval: { title: "timeline.partInstalledPending", description: "timeline.partInstalledPendingDescription" },
  returned: { title: "timeline.partReturnedUnused", description: "timeline.partReturnedUnusedDescription" },
  installed: { title: "timeline.partConsumed", description: "timeline.partConsumedDescription" },
  removed_returned_to_stock: { title: "timeline.partRemovedReturned", description: "timeline.partRemovedReturnedDescription" },
  consumed_after_office_approval: { title: "timeline.partConsumed", description: "timeline.partConsumedDescription" },
  removed: { title: "timeline.partRemovedInspection", description: "timeline.partRemovedInspectionDescription" },
  removed_inspection_required: { title: "timeline.partRemovedInspection", description: "timeline.partRemovedInspectionDescription" },
  inspection_required: { title: "timeline.partRemovedInspection", description: "timeline.partRemovedInspectionDescription" },
};

function serializedPartIdentity(event) {
  const partNumber = String(event.part_number || event.partNumber || "").trim();
  const serialNumber = String(event.serial_number || event.serialNumber || "").trim();
  if (!partNumber) return "";
  return serialNumber ? `${partNumber} · ${serialNumber}` : partNumber;
}

export function humanizeStatus(value, locale = "en") {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "";
  return STATUS_KEYS[key] ? interfaceText(locale, STATUS_KEYS[key]) : key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanizeEventValue(value, fallback = "Updated") {
  const text = String(value || fallback).trim().replaceAll("_", " ");
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function timelineEventTitle(event, locale = "en") {
  const t = (key) => interfaceText(locale, key);
  if (event.type === "access") return t("timeline.opened");
  if (event.type === "part") {
    const serializedAction = SERIALIZED_PART_ACTIONS[event.action];
    return serializedAction ? t(serializedAction.title) : `${t("timeline.part")} ${humanizeEventValue(event.action).toLowerCase()}`;
  }
  if (event.type === "attention") {
    const subject = event.field_key === "missing_info" ? t("timeline.informationRequest") : humanizeEventValue(event.field_key, t("timeline.attention"));
    return event.action === "resolved" ? `${subject} ${t("timeline.resolved")}` : subject;
  }
  if (event.type === "field") {
    if (event.field_key === "work_details_updated") return t("timeline.workDetailsUpdated");
    return `${event.field_label || event.action || t("timeline.field")} ${t("timeline.changed")}`;
  }
  if (event.type === "assignment") {
    if (event.action === "reassigned") return t(event.from_mechanic_id ? "timeline.mechanicReassigned" : "timeline.mechanicAssigned");
    if (event.action === "unassigned") return t("timeline.returnedQueue");
    return t("timeline.assignmentChanged");
  }

  const from = humanizeStatus(event.from_status || "created", locale);
  const to = humanizeStatus(event.to_status, locale);
  if (!to) return from || t("timeline.workorderUpdated");
  if (!event.from_status || event.from_status === event.to_status) return to;
  return event.to_status === "in_progress" ? to : `${from} ${t("timeline.to")} ${to}`;
}

export function timelineEventDescription(event, locale = "en") {
  const t = (key) => interfaceText(locale, key);
  if (event.type === "part" && SERIALIZED_PART_ACTIONS[event.action]) {
    const identity = serializedPartIdentity(event);
    const message = t(SERIALIZED_PART_ACTIONS[event.action].description);
    return identity ? `${identity}: ${message}` : event.note || message;
  }
  if (event.type === "assignment") {
    const from = event.from_mechanic_name || t("timeline.unassigned");
    const to = event.to_mechanic_name || t("timeline.unassigned");
    const description = event.action === "accepted"
      ? `${to} ${t("timeline.acceptedWorkorder")}`
      : event.action === "unassigned"
        ? `${from} ${t("timeline.returnedWorkorder")}`
        : `${from} ${t("timeline.changedTo")} ${to}.`;
    return event.note ? `${description} ${event.note}` : description;
  }
  if (event.type === "field") {
    if (event.field_key === "work_details_updated") {
      try {
        const details = JSON.parse(event.new_value || "{}");
        const fields = Array.isArray(details.fieldsChanged) ? details.fieldsChanged : [];
        if (fields.length === 2) return t("timeline.diagnosisRepairSaved");
        if (fields.includes("diagnosis")) return t("timeline.diagnosisSaved");
        if (fields.includes("workPerformed")) return t("timeline.repairSaved");
      } catch {
        // Use stable grouped-event copy.
      }
      return t("timeline.progressSaved");
    }
    if (String(event.field_label || "").toLowerCase() === "used parts") {
      try {
        const parts = JSON.parse(event.new_value || "[]")
          .filter((part) => part?.partNo)
          .map((part) => `${formatQuantity(part.qty, part.uomCode) || t("timeline.quantityNotRecorded")} × ${part.partNo}`);
        return parts.length ? `${t("timeline.usedParts")}: ${parts.join(", ")}.` : t("timeline.usedPartsCleared");
      } catch {
        return t("timeline.usedPartsUpdated");
      }
    }
    const label = event.field_label || t("timeline.field");
    if (event.new_value) return `${label} ${t("timeline.updatedTo")} ${event.new_value}.`;
    return `${label} ${t("timeline.cleared")}`;
  }
  return event.note || t("timeline.workorderUpdatedSentence");
}

export function meaningfulTimelineEvents(timeline) {
  return (timeline || []).filter((event) => event.type !== "access");
}

function timelineActorKey(event) {
  if (event.actor_user_id) return `user:${event.actor_user_id}`;
  if (event.changed_by_name) return `name:${event.changed_by_name}`;
  return `system:${event.actor_role || "unknown"}`;
}

function timelineEventFamily(event) {
  if (event.type === "field") return `field:${event.field_key || event.field_label || event.action || "updated"}`;
  if (event.type === "status") return `status:${event.from_status || "created"}:${event.to_status || "updated"}`;
  if (event.type === "assignment") return `assignment:${event.action || "updated"}`;
  if (event.type === "attention") return `attention:${event.field_key || "attention"}:${event.action || "updated"}`;
  if (event.type === "part") return `part:${event.action || "updated"}`;
  return `${event.type || "activity"}:${event.action || event.field_key || "updated"}`;
}

function timelineEventTime(event) {
  const timestamp = Date.parse(event.created_at || "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

function canJoinTimelineGroup(group, event) {
  if (group.actorKey !== timelineActorKey(event) || group.family !== timelineEventFamily(event)) return false;
  const previousTime = timelineEventTime(group.children[group.children.length - 1]);
  const nextTime = timelineEventTime(event);
  if (previousTime === null || nextTime === null) return false;
  const gap = nextTime - previousTime;
  return gap >= 0 && gap <= ACTIVITY_GROUP_WINDOW_MS;
}

function timelineGroupId(event) {
  return `${timelineEventFamily(event)}:${timelineActorKey(event)}:${event.type || "activity"}:${event.id ?? event.created_at ?? "event"}`;
}

function finishTimelineGroup(group, locale) {
  const lastEvent = group.children[group.children.length - 1];
  return {
    id: group.id,
    actorUserId: lastEvent.actor_user_id || null,
    actorName: lastEvent.changed_by_name || interfaceText(locale, "timeline.system"),
    actorRole: lastEvent.actor_role || "",
    createdAt: lastEvent.created_at || group.children[0]?.created_at || null,
    title: timelineEventTitle(lastEvent, locale),
    description: timelineEventDescription(lastEvent, locale),
    childCount: group.children.length,
    children: group.children,
  };
}

export function groupTimelineEvents(timeline, locale = "en") {
  const groups = [];

  for (const event of meaningfulTimelineEvents(timeline)) {
    const current = groups[groups.length - 1];
    if (current && canJoinTimelineGroup(current, event)) {
      current.children.push(event);
      continue;
    }
    groups.push({
      id: timelineGroupId(event),
      actorKey: timelineActorKey(event),
      family: timelineEventFamily(event),
      children: [event],
    });
  }

  return groups.map((group) => finishTimelineGroup(group, locale));
}

export function timelineEventCount(timeline) {
  return groupTimelineEvents(timeline).length;
}
