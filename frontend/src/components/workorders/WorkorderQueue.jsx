import { ChevronRight } from "@untitledui/icons";
import { ageLabel, durationLabel, formatCreatedAt } from "../../lib/dates.js";
import { WorkorderStatusPill } from "./WorkorderStatusPill.jsx";
import "./workorder-queue.css";

const ATTENTION_LABELS = Object.freeze({
  parts: "Needs parts",
  office_help: "Needs office",
  missing_info: "Missing info",
  overdue: "Overdue",
});

const LIFECYCLE_LABELS = Object.freeze({
  open: "Unassigned",
  accepted: "Accepted",
  in_progress: "In progress",
  mechanic_done: "Ready for review",
  closed: "Closed",
  odoo_entered: "Odoo entered",
  cancelled: "Cancelled",
});

function normalizedLifecycle(workorder) {
  if (workorder.lifecycle) return workorder.lifecycle;
  if (["waiting_office", "parts_requested"].includes(workorder.status)) return "in_progress";
  return workorder.status || "open";
}

function normalizedAttention(workorder) {
  if (Array.isArray(workorder.attentionReasons)) return workorder.attentionReasons;
  if (workorder.status === "parts_requested") return ["parts"];
  if (workorder.status === "waiting_office") return ["office_help"];
  return [];
}

function odooLabel(status) {
  if (status === "entered") return "Entered";
  if (status === "missing_info") return "Missing info";
  return "Needs Odoo";
}

export function workorderMatchesSearch(workorder, search) {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  const createdDate = workorder.createdAt ? new Date(workorder.createdAt) : null;
  return [
    workorder.serial,
    workorder.assetUnitNo,
    workorder.assetLabel,
    workorder.asset?.unitNo,
    workorder.asset?.name,
    workorder.concern,
    workorder.locationName,
    workorder.location?.name,
    workorder.mechanicName,
    workorder.mechanic?.name,
    workorder.statusLabel,
    workorder.lastMessage,
    createdDate ? formatCreatedAt(workorder.createdAt) : "",
    createdDate ? createdDate.toLocaleDateString() : "",
    createdDate ? createdDate.toISOString().slice(0, 10) : "",
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(term));
}

export function WorkorderQueueTabs({ tabs, activeTab, onChange }) {
  return (
    <nav className="mechanic-queue-tabs" aria-label="Workorder queues">
      {tabs.map(({ key, label, count, icon: Icon }) => (
        <button className={activeTab === key ? "active" : ""} type="button" key={key} onClick={() => onChange(key)} aria-current={activeTab === key ? "page" : undefined}>
          {Icon ? <Icon /> : null}
          <span>{label}</span>
          <strong>{count || 0}</strong>
        </button>
      ))}
    </nav>
  );
}

export function WorkorderAttention({ reasons = [] }) {
  const uniqueReasons = [...new Set(reasons)].filter((reason) => ATTENTION_LABELS[reason]);
  if (!uniqueReasons.length) return <span className="queue-attention-none">No blocker</span>;
  return (
    <span className="queue-attention" aria-label={uniqueReasons.map((reason) => ATTENTION_LABELS[reason]).join(", ")}>
      {uniqueReasons.slice(0, 2).map((reason) => <span className={`queue-attention-pill attention-${reason}`} key={reason}>{ATTENTION_LABELS[reason]}</span>)}
      {uniqueReasons.length > 2 ? <span className="queue-attention-more">+{uniqueReasons.length - 2}</span> : null}
    </span>
  );
}

export function WorkorderTableHeader({ office = false, variant = office ? "office" : "mechanic" }) {
  if (variant === "surveillance") {
    return (
      <div className="mechanic-list-head queue-variant-surveillance" aria-hidden="true">
        <span>Unit / Workorder</span><span className="queue-wide-only">Problem</span><span>Location</span><span>Mechanics</span><span className="queue-wide-only">Waiting</span><span>Last activity</span><span>Status</span><span></span>
      </div>
    );
  }
  if (variant === "office") {
    return (
      <div className="mechanic-list-head queue-variant-office" aria-hidden="true">
        <span>Unit / Workorder</span><span>Problem</span><span>Location</span><span>Mechanics</span><span>Attention</span><span>Waiting</span><span>Status</span><span></span>
      </div>
    );
  }
  return (
    <div className="mechanic-list-head queue-variant-mechanic" aria-hidden="true">
      <span>Unit / Workorder</span><span>Problem</span><span className="queue-wide-only">Location</span><span className="queue-wide-only">Team</span><span>Attention</span><span>Created</span><span>Status</span><span></span>
    </div>
  );
}

export function WorkorderRow({ workorder, available = false, busy = false, featured = false, office = false, variant = office ? "office" : "mechanic", onOpen, onAccept }) {
  const lifecycle = normalizedLifecycle(workorder);
  const attention = normalizedAttention(workorder);
  const unit = workorder.assetUnitNo || workorder.assetLabel || workorder.asset?.unitNo || workorder.asset?.name || "No unit selected";
  const location = workorder.locationName || workorder.location?.name || "Location not set";
  const mechanic = workorder.mechanics?.map((member) => member.name).filter(Boolean).join(", ")
    || workorder.mechanicName
    || workorder.mechanic?.name
    || "Unassigned";
  const lastActivity = workorder.lastActivityAt || workorder.updatedAt || workorder.createdAt;
  const waiting = durationLabel(workorder.timeInStatusSeconds) || ageLabel(lastActivity);
  const statusLabel = LIFECYCLE_LABELS[lifecycle] || workorder.statusLabel || lifecycle;
  const isSurveillance = variant === "surveillance";
  const hasOdooStage = ["closed", "odoo_entered"].includes(lifecycle);
  const rowStatus = isSurveillance && hasOdooStage
    ? (workorder.odooStatus === "entered" ? "odoo_entered" : workorder.odooStatus === "missing_info" ? "waiting_office" : "closed")
    : lifecycle;
  const rowStatusLabel = isSurveillance && hasOdooStage ? odooLabel(workorder.odooStatus) : statusLabel;

  return (
    <article className={`mechanic-work-row queue-row-${variant} ${workorder.unread ? "is-unread" : ""} ${featured ? "is-current" : ""}`}>
      <button className={`mechanic-work-open queue-variant-${variant}`} type="button" onClick={onOpen} aria-label={`Open ${workorder.serial}`}>
        <span className="work-row-identity">
          <span className="work-row-unit"><strong>{unit}</strong>{workorder.unread ? <small className="queue-unread-label">New</small> : null}</span>
          <small>{workorder.serial}</small>
        </span>
        {isSurveillance ? (
          <>
            <span className="work-row-concern queue-wide-only">{workorder.concern || "Problem not recorded"}</span>
            <span className="work-row-location">{location}</span>
            <span className="work-row-mechanic">{mechanic}</span>
            <span className="work-row-age queue-wide-only">{waiting || "Now"}</span>
            <span className="work-row-created">{formatCreatedAt(lastActivity)}</span>
          </>
        ) : (
          <>
            <span className="work-row-concern">{workorder.concern || "Problem not recorded"}</span>
            {variant === "mechanic" ? <span className="work-row-location queue-wide-only">{location}</span> : null}
            {variant === "mechanic" ? <span className="work-row-mechanic queue-wide-only">{mechanic}</span> : null}
            {variant === "office" ? <span className="work-row-location">{location}</span> : null}
            {variant === "office" ? <span className="work-row-mechanic">{mechanic}</span> : null}
            <WorkorderAttention reasons={attention} />
            {variant === "office" ? <span className="work-row-age">{waiting || "Now"}</span> : <span className="work-row-created">{formatCreatedAt(workorder.createdAt)}</span>}
          </>
        )}
        <WorkorderStatusPill status={rowStatus} label={rowStatusLabel} />
        <ChevronRight className="work-row-chevron" />
      </button>
      {available ? (
        <button className="accept-work-button" type="button" onClick={onAccept} disabled={busy}>
          {busy ? "Accepting..." : "Accept work"}
        </button>
      ) : null}
    </article>
  );
}
