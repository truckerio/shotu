import { useId, useState } from "react";
import { ChevronDown } from "@untitledui/icons";
import { formatCreatedAt } from "../../lib/dates.js";
import {
  groupTimelineEvents,
  timelineEventDescription,
  timelineEventTitle,
} from "./workorder-timeline-model.js";
import "./workorder-timeline.css";

function actorRoleLabel(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "office" || normalized === "manager") return "Manager";
  return normalized.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function TimelineMeta({ actorName, actorRole, createdAt, event = {} }) {
  const role = actorRoleLabel(actorRole);
  const fallbackActorName = event.changed_by_name || "System";
  return (
    <span className="workorder-timeline-date">
      <strong>{actorName || fallbackActorName}</strong>
      {role ? <span className="workorder-timeline-role">{role}</span> : null}
      <span aria-hidden="true">·</span>
      {createdAt ? (
        <time dateTime={createdAt}>{formatCreatedAt(createdAt)}</time>
      ) : <span>Time unavailable</span>}
    </span>
  );
}

export function WorkorderTimeline({ timeline }) {
  const timelineId = useId();
  const groups = groupTimelineEvents(timeline);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  if (!groups.length) return <p className="chat-empty">No activity yet.</p>;

  function toggleGroup(groupId) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  return (
    <ol className="workorder-timeline-list">
      {groups.map((group, index) => {
        const expandable = group.childCount > 1;
        const expanded = expandable && expandedGroups.has(group.id);
        const childrenId = `${timelineId}-group-${index}`;
        return (
        <li key={group.id} className={expandable ? "has-children" : ""}>
          <TimelineMeta
            actorName={group.actorName}
            actorRole={group.actorRole}
            createdAt={group.createdAt}
            event={group.children[group.children.length - 1]}
          />
          <span className="workorder-timeline-marker" aria-hidden="true" />
          <div className="workorder-timeline-event">
            <div className="workorder-timeline-event-heading">
              <strong>{group.title}</strong>
              {expandable ? (
                <button
                  className="workorder-timeline-toggle"
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={childrenId}
                  onClick={() => toggleGroup(group.id)}
                >
                  <span>{group.childCount} changes</span>
                  <ChevronDown aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <span className="workorder-timeline-description">{group.description}</span>
            {expandable && expanded ? (
              <ol className="workorder-timeline-children" id={childrenId} aria-label={`${group.title} changes`}>
                {group.children.map((event, childIndex) => (
                  <li key={`${event.type}-${event.id ?? childIndex}`}>
                    <div className="workorder-timeline-child-heading">
                      <strong>{timelineEventTitle(event)}</strong>
                      {event.created_at ? <time dateTime={event.created_at}>{formatCreatedAt(event.created_at)}</time> : null}
                    </div>
                    <span>{timelineEventDescription(event)}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </li>
        );
      })}
    </ol>
  );
}

export function WorkorderTimelinePanel({ timeline, participants = [], className = "" }) {
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
      <WorkorderTimeline timeline={timeline} />
    </section>
  );
}
