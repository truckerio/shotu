import { formatCreatedAt } from "../../lib/dates.js";
import {
  meaningfulTimelineEvents,
  timelineEventDescription,
  timelineEventTitle,
} from "./workorder-timeline-model.js";
import "./workorder-timeline.css";

export function WorkorderTimeline({ timeline }) {
  const meaningfulTimeline = meaningfulTimelineEvents(timeline);
  if (!meaningfulTimeline.length) return <p className="chat-empty">No activity yet.</p>;

  return (
    <ol className="workorder-timeline-list">
      {meaningfulTimeline.map((event) => (
        <li key={`${event.type}-${event.id}`}>
          <div>
            <strong>{timelineEventTitle(event)}</strong>
            <span>{timelineEventDescription(event)}</span>
          </div>
          <small>{[event.changed_by_name || "System", formatCreatedAt(event.created_at)].filter(Boolean).join(" · ")}</small>
        </li>
      ))}
    </ol>
  );
}

export function WorkorderTimelinePanel({ timeline, participants = [], className = "" }) {
  const meaningfulTimeline = meaningfulTimelineEvents(timeline);

  return (
    <section className={`workorder-timeline-panel is-compact ${className}`.trim()} aria-label="Workorder timeline">
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
