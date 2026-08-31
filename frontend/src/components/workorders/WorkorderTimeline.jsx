import { useId, useState } from "react";
import { ChevronDown } from "@untitledui/icons";
import { formatLocaleNumber, interfaceText } from "../../i18n/index.js";
import { formatCreatedAt } from "../../lib/dates.js";
import {
  groupTimelineEvents,
  timelineEventDescription,
  timelineEventTitle,
} from "./workorder-timeline-model.js";
import "./workorder-timeline.css";

function actorRoleLabel(role, locale) {
  const normalized = String(role || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "office" || normalized === "manager") return interfaceText(locale, "timeline.manager");
  if (["admin", "mechanic", "surveillance"].includes(normalized)) {
    return interfaceText(locale, `timeline.role.${normalized}`);
  }
  return normalized.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function TimelineMeta({ actorLabel, actorName, actorRole, createdAt, dateText, event = {}, locale = "en" }) {
  const role = actorLabel || actorRoleLabel(actorRole, locale);
  const fallbackActorName = event.changed_by_name || interfaceText(locale, "timeline.system");
  return (
    <span className="workorder-timeline-date">
      <strong>{actorName || fallbackActorName}</strong>
      {role ? <span className="workorder-timeline-role">{role}</span> : null}
      <span aria-hidden="true">·</span>
      {createdAt ? (
        <time dateTime={createdAt}>{dateText || formatCreatedAt(createdAt, locale)}</time>
      ) : <span>{interfaceText(locale, "timeline.timeUnavailable")}</span>}
    </span>
  );
}

export function WorkorderTimelineList({ className = "", emptyMessage, items, locale = "en" }) {
  if (!items.length) return <p className="chat-empty">{emptyMessage ?? interfaceText(locale, "timeline.noActivity")}</p>;

  return (
    <ol className={`workorder-timeline-list ${className}`.trim()}>
      {items.map((item) => (
        <li key={item.id} className={item.className || ""}>
          <TimelineMeta
            actorLabel={item.actorLabel}
            actorName={item.actorName}
            actorRole={item.actorRole}
            createdAt={item.createdAt}
            dateText={item.dateText}
            event={item.event}
            locale={locale}
          />
          <span className="workorder-timeline-marker" aria-hidden="true" />
          <div className="workorder-timeline-event">
            <div className="workorder-timeline-event-heading">
              <strong>{item.title}</strong>
              {item.action || null}
            </div>
            {item.description ? <span className="workorder-timeline-description">{item.description}</span> : null}
            {item.details?.length ? (
              <dl className="workorder-timeline-details">
                {item.details.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
            ) : null}
            {item.content || null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function WorkorderTimeline({ timeline, locale = "en" }) {
  const t = (key) => interfaceText(locale, key);
  const timelineId = useId();
  const groups = groupTimelineEvents(timeline, locale);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());

  function toggleGroup(groupId) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  const items = groups.map((group, index) => {
        const expandable = group.childCount > 1;
        const expanded = expandable && expandedGroups.has(group.id);
        const childrenId = `${timelineId}-group-${index}`;
        return {
          id: group.id,
          className: expandable ? "has-children" : "",
          actorName: group.actorName,
          actorRole: group.actorRole,
          createdAt: group.createdAt,
          event: group.children[group.children.length - 1],
          title: group.title,
          description: group.description,
          action: expandable ? (
                <button
                  className="workorder-timeline-toggle"
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={childrenId}
                  onClick={() => toggleGroup(group.id)}
                >
                  <span>{formatLocaleNumber(group.childCount, locale)} {t("timeline.changes")}</span>
                  <ChevronDown aria-hidden="true" />
                </button>
              ) : null,
          content: expandable && expanded ? (
              <ol className="workorder-timeline-children" id={childrenId} aria-label={`${group.title} ${t("timeline.changes")}`}>
                {group.children.map((event, childIndex) => (
                  <li key={`${event.type}-${event.id ?? childIndex}`}>
                    <div className="workorder-timeline-child-heading">
                      <strong>{timelineEventTitle(event, locale)}</strong>
                      {event.created_at ? <time dateTime={event.created_at}>{formatCreatedAt(event.created_at, locale)}</time> : null}
                    </div>
                    <span>{timelineEventDescription(event, locale)}</span>
                  </li>
                ))}
              </ol>
            ) : null,
        };
      });

  return <WorkorderTimelineList items={items} locale={locale} />;
}

export function WorkorderTimelinePanel({ timeline, participants = [], className = "", locale = "en" }) {
  const t = (key) => interfaceText(locale, key);
  return (
    <section className={`workorder-timeline-panel is-compact ${className}`.trim()} aria-label={t("timeline.workorderTimeline")}>
      {participants.length ? (
        <div className="workorder-participants">
          <span className="workorder-participants-label">{t("timeline.mechanics")}</span>
          <span>
            {participants.map((participant) => (
              `${participant.name}${participant.isCurrent ? ` (${t("timeline.current")})` : ""}`
            )).join(", ")}
          </span>
        </div>
      ) : null}
      <WorkorderTimeline timeline={timeline} locale={locale} />
    </section>
  );
}
