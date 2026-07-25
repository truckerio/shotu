import { formatCreatedAt } from "../../lib/dates.js";

function timelineTitle(event) {
  if (event.type === "access") return "Workorder opened";
  if (event.type === "part") return `Part ${String(event.action || "updated").replaceAll("_", " ")}`;
  if (event.type === "attention") {
    const subject = event.field_key === "missing_info" ? "Information request" : String(event.field_key || "Attention").replaceAll("_", " ");
    return event.action === "resolved" ? `${subject} resolved` : subject;
  }
  if (event.type === "field") return `${event.field_label || event.action || "Field"} changed`;
  if (event.type === "assignment") {
    if (event.action === "reassigned") return event.from_mechanic_id ? "Mechanic reassigned" : "Mechanic assigned";
    if (event.action === "unassigned") return "Returned to available queue";
    return "Assignment changed";
  }
  return `${event.from_status || "created"} -> ${event.to_status}`;
}

function timelineBody(event) {
  if (event.type === "assignment") {
    const from = event.from_mechanic_name || "Unassigned";
    const to = event.to_mechanic_name || "Unassigned";
    const assignment = event.action === "accepted" ? `${to} accepted the workorder.` : `${from} -> ${to}.`;
    return event.note ? `${assignment} ${event.note}` : assignment;
  }
  if (event.type === "field") {
    if (String(event.field_label || "").toLowerCase() === "used parts") {
      try {
        const parts = JSON.parse(event.new_value || "[]")
          .filter((part) => part?.partNo)
          .map((part) => `${part.qty || 1} x ${part.partNo}`);
        return parts.length ? `Current used parts: ${parts.join(", ")}.` : "Used parts cleared.";
      } catch {
        return "Used parts updated.";
      }
    }
    const oldValue = event.old_value || "blank";
    const newValue = event.new_value || "blank";
    return `${oldValue} -> ${newValue}`;
  }
  return event.note || event.changed_by_name || "System update";
}

export function WorkorderTimeline({ timeline }) {
  if (!timeline?.length) return <p className="chat-empty">No timeline yet.</p>;

  return (
    <div className="office-timeline">
      {timeline.map((event) => (
        <div key={`${event.type}-${event.id}`}>
          <strong>{timelineTitle(event)}</strong>
          <span>{timelineBody(event)}</span>
          <small>
            {[event.changed_by_name, formatCreatedAt(event.created_at)].filter(Boolean).join(" / ")}
          </small>
        </div>
      ))}
    </div>
  );
}

export function WorkorderTimelinePanel({ timeline, participants = [], className = "" }) {
  const count = timeline?.length || 0;

  return (
    <section className={`workorder-timeline-panel ${className}`.trim()} aria-label="Workorder timeline">
      <header>
        <h2>Timeline</h2>
        <span>{count} {count === 1 ? "event" : "events"}</span>
      </header>
      {participants.length ? (
        <div className="workorder-participants">
          <strong>Mechanics involved</strong>
          <span>
            {participants.map((participant) => (
              `${participant.name}${participant.isCurrent ? " (current)" : ""}`
            )).join(", ")}
          </span>
        </div>
      ) : null}
      <WorkorderTimeline timeline={timeline} />
    </section>
  );
}
