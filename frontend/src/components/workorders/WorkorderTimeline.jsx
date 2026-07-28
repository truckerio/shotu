import { formatCreatedAt } from "../../lib/dates.js";
import {
  meaningfulTimelineEvents,
  timelineEventDescription,
  timelineEventStatus,
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
          <span className="workorder-timeline-marker" aria-hidden="true" />
          <div className="workorder-timeline-event">
            <div className="workorder-timeline-event-heading">
              <strong>{timelineEventTitle(event)}</strong>
              {timelineEventStatus(event) ? (
                <span className="workorder-timeline-status">{timelineEventStatus(event)}</span>
              ) : null}
            </div>
            <span className="workorder-timeline-description">{timelineEventDescription(event)}</span>
            <small className="workorder-timeline-meta">
              <span>{event.changed_by_name || "System"}</span>
              {event.created_at ? <time dateTime={event.created_at}>{formatCreatedAt(event.created_at)}</time> : null}
            </small>
          </div>
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
          <span className="workorder-participants-label">Mechanics</span>
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
