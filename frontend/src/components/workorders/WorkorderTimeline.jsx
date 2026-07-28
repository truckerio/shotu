import { formatCreatedAt } from "../../lib/dates.js";
import { meaningfulTimelineEvents, timelineEventTitle } from "./workorder-timeline-model.js";
import "./workorder-timeline.css";

function timelineBody(event) {
  if (event.type === "assignment") {
    const from = event.from_mechanic_name || "Unassigned";
    const to = event.to_mechanic_name || "Unassigned";
    const assignment = event.action === "accepted" ? `${to} accepted the workorder.` : `${from} -> ${to}.`;
    return event.note ? `${assignment} ${event.note}` : assignment;
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
        // Fall through to the stable grouped-event label.
      }
      return "Mechanic progress saved.";
    }
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
  const meaningfulTimeline = meaningfulTimelineEvents(timeline);
  if (!meaningfulTimeline.length) return <p className="chat-empty">No activity yet.</p>;

  return (
    <div className="office-timeline">
      {meaningfulTimeline.map((event) => (
        <div key={`${event.type}-${event.id}`}>
          <strong>{timelineEventTitle(event)}</strong>
          <span>{timelineBody(event)}</span>
          <small>
            {[event.changed_by_name, formatCreatedAt(event.created_at)].filter(Boolean).join(" / ")}
          </small>
        </div>
      ))}
    </div>
  );
}

export function WorkorderTimelinePanel({ timeline, participants = [], className = "", compact = className.includes("is-control-timeline") }) {
  const meaningfulTimeline = meaningfulTimelineEvents(timeline);
  const count = meaningfulTimeline.length;

  return (
    <section className={`workorder-timeline-panel ${compact ? "is-compact" : ""} ${className}`.trim()} aria-label="Workorder timeline">
      {!compact ? <header>
        <h2>Timeline</h2>
        <span>{count} {count === 1 ? "event" : "events"}</span>
      </header> : null}
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
      <WorkorderTimeline timeline={meaningfulTimeline} />
    </section>
  );
}
