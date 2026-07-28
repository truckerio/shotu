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

export function timelineEventTitle(event) {
  if (event.type === "access") return "Workorder opened";
  if (event.type === "part") return `Part ${String(event.action || "updated").replaceAll("_", " ")}`;
  if (event.type === "attention") {
    const subject = event.field_key === "missing_info" ? "Information request" : String(event.field_key || "Attention").replaceAll("_", " ");
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

export function meaningfulTimelineEvents(timeline) {
  return (timeline || []).filter((event) => event.type !== "access");
}
