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
          .map((part) => `${part.qty || 1} × ${part.partNo}`);
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

export function timelineEventCount(timeline) {
  return meaningfulTimelineEvents(timeline).length;
}
