import { formatQuantity } from "../../../../shared/units-of-measure.js";

const STATUS_LABELS = {
  created: "Created",
  pending: "Pending",
  submitted: "Submitted",
  assigned: "Assigned",
  accepted: "Accepted",
  in_progress: "Work started",
  parts_requested: "Parts requested",
  waiting_office: "Waiting for office",
  mechanic_done: "Work completed",
  completed: "Completed",
  cancelled: "Cancelled",
};

const ACTIVITY_GROUP_WINDOW_MS = 2 * 60 * 1000;

export function humanizeStatus(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "";
  return STATUS_LABELS[key] || key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanizeEventValue(value, fallback = "Updated") {
  const text = String(value || fallback).trim().replaceAll("_", " ");
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function timelineEventTitle(event) {
  if (event.type === "access") return "Workorder opened";
  if (event.type === "part") return `Part ${humanizeEventValue(event.action).toLowerCase()}`;
  if (event.type === "attention") {
    const subject = event.field_key === "missing_info" ? "Information request" : humanizeEventValue(event.field_key, "Attention");
    return event.action === "resolved" ? `${subject} resolved` : subject;
  }
  if (event.type === "field") {
    if (event.field_key === "work_details_updated") return "Work details updated";
    return `${event.field_label || event.action || "Field"} changed`;
  }
  if (event.type === "assignment") {
    if (event.action === "reassigned") return event.from_mechanic_id ? "Mechanic reassigned" : "Mechanic assigned";
    if (event.action === "unassigned") return "Returned to available queue";
    return "Assignment changed";
  }

  const from = humanizeStatus(event.from_status || "created");
  const to = humanizeStatus(event.to_status);
  if (!to) return from || "Workorder updated";
  if (!event.from_status || event.from_status === event.to_status) return to;
  return to === "Work started" ? to : `${from} to ${to}`;
}

export function timelineEventDescription(event) {
  if (event.type === "assignment") {
    const from = event.from_mechanic_name || "Unassigned";
    const to = event.to_mechanic_name || "Unassigned";
    const description = event.action === "accepted"
      ? `${to} accepted the workorder.`
      : event.action === "unassigned"
        ? `${from} returned the workorder to the available queue.`
        : `${from} changed to ${to}.`;
    return event.note ? `${description} ${event.note}` : description;
  }
  if (event.type === "field") {
    if (event.field_key === "work_details_updated") {
      try {
        const details = JSON.parse(event.new_value || "{}");
        const fields = Array.isArray(details.fieldsChanged) ? details.fieldsChanged : [];
        if (fields.length === 2) return "Diagnosis and repair details saved.";
        if (fields.includes("diagnosis")) return "Diagnosis saved.";
        if (fields.includes("workPerformed")) return "Repair details saved.";
      } catch {
        // Use stable grouped-event copy.
      }
      return "Mechanic progress saved.";
    }
    if (String(event.field_label || "").toLowerCase() === "used parts") {
      try {
        const parts = JSON.parse(event.new_value || "[]")
          .filter((part) => part?.partNo)
          .map((part) => `${formatQuantity(part.qty, part.uomCode) || "Quantity not recorded"} × ${part.partNo}`);
        return parts.length ? `Used parts: ${parts.join(", ")}.` : "Used parts cleared.";
      } catch {
        return "Used parts updated.";
      }
    }
    const label = event.field_label || "Field";
    if (event.new_value) return `${label} updated to ${event.new_value}.`;
    return `${label} cleared.`;
  }
  return event.note || "Workorder updated.";
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

function finishTimelineGroup(group) {
  const lastEvent = group.children[group.children.length - 1];
  return {
    id: group.id,
    actorUserId: lastEvent.actor_user_id || null,
    actorName: lastEvent.changed_by_name || "System",
    actorRole: lastEvent.actor_role || "",
    createdAt: lastEvent.created_at || group.children[0]?.created_at || null,
    title: timelineEventTitle(lastEvent),
    description: timelineEventDescription(lastEvent),
    childCount: group.children.length,
    children: group.children,
  };
}

export function groupTimelineEvents(timeline) {
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

  return groups.map(finishTimelineGroup);
}

export function timelineEventCount(timeline) {
  return groupTimelineEvents(timeline).length;
}
