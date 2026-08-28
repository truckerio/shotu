import { ChevronRight } from "@untitledui/icons";
import { ageLabel, durationLabel } from "../../lib/dates.js";
import {
  formatLifecycleLabel,
  formatUiDate,
  formatUiDateTime,
} from "../../lib/workorder-presentation.js";
import { workorderMobileMeta, workorderOpenLabel } from "../responsive/workorder-queue-config.js";
import { WorkorderStatusPill } from "./WorkorderStatusPill.jsx";
import { formatLocaleNumber, interfaceText } from "../../i18n/index.js";
import "./workorder-queue.css";

const ATTENTION_KEYS = Object.freeze({
  parts: "queue.needsParts",
  office_help: "queue.needsOffice",
  missing_info: "queue.missingInfo",
  overdue: "queue.overdue",
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

const STATUS_KEYS = Object.freeze({
  open: "status.open",
  accepted: "status.accepted",
  in_progress: "status.inProgress",
  mechanic_done: "status.workDone",
  closed: "status.closed",
  cancelled: "status.cancelled",
  waiting_office: "status.waitingOffice",
  parts_requested: "status.partsRequested",
});

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
    createdDate ? formatUiDateTime(workorder.createdAt) : "",
    createdDate ? formatUiDate(workorder.createdAt) : "",
    createdDate ? createdDate.toISOString().slice(0, 10) : "",
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(term));
}

export function WorkorderQueueTabs({ tabs, activeTab, onChange, locale = "en" }) {
  const t = (key) => interfaceText(locale, key);
  return (
    <nav className="mechanic-queue-tabs" aria-label={t("queue.workorders")}>
      {tabs.map(({ key, label, count, icon: Icon }) => (
        <button className={activeTab === key ? "active" : ""} type="button" key={key} onClick={() => onChange(key)} aria-current={activeTab === key ? "page" : undefined} aria-label={`${label}, ${formatLocaleNumber(count || 0, locale)} ${t("queue.workordersCount")}`}>
          {Icon ? <Icon aria-hidden="true" /> : null}
          <span>{label}</span>
          <strong aria-hidden="true">{formatLocaleNumber(count || 0, locale)}</strong>
        </button>
      ))}
    </nav>
  );
}

export function WorkorderAttention({ reasons = [], locale = "en" }) {
  const t = (key) => interfaceText(locale, key);
  const uniqueReasons = [...new Set(reasons)].filter((reason) => ATTENTION_KEYS[reason]);
  if (!uniqueReasons.length) return <span className="queue-attention-none">{t("queue.noBlocker")}</span>;
  return (
    <span className="queue-attention" aria-label={uniqueReasons.map((reason) => t(ATTENTION_KEYS[reason])).join(", ")}>
      {uniqueReasons.slice(0, 2).map((reason) => <span className={`queue-attention-pill attention-${reason}`} key={reason}>{t(ATTENTION_KEYS[reason])}</span>)}
      {uniqueReasons.length > 2 ? <span className="queue-attention-more">+{uniqueReasons.length - 2}</span> : null}
    </span>
  );
}

export function WorkorderTableHeader({ office = false, variant = office ? "office" : "mechanic", locale = "en" }) {
  const t = (key) => interfaceText(locale, key);
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
      <span>{t("queue.unitWorkorder")}</span><span>{t("queue.problem")}</span><span className="queue-wide-only">{t("queue.location")}</span><span className="queue-wide-only">{t("queue.team")}</span><span>{t("queue.attention")}</span><span className="queue-header-created">{t("queue.created")}</span><span className="queue-header-status">{t("queue.status")}</span><span></span>
    </div>
  );
}

export function WorkorderRow({ workorder, available = false, busy = false, featured = false, office = false, variant = office ? "office" : "mechanic", acceptLabel, busyLabel, locale = "en", onOpen, onAccept }) {
  const t = (key) => interfaceText(locale, key);
  const lifecycle = normalizedLifecycle(workorder);
  const attention = normalizedAttention(workorder);
  const knownUnit = workorder.assetUnitNo || workorder.assetLabel || workorder.asset?.unitNo || workorder.asset?.name;
  const knownLocation = workorder.locationName || workorder.location?.name;
  const knownMechanic = workorder.mechanics?.map((member) => member.name).filter(Boolean).join(", ")
    || workorder.mechanicName
    || workorder.mechanic?.name;
  const unit = knownUnit || t("queue.noUnit");
  const location = knownLocation || t("queue.noLocation");
  const mechanic = knownMechanic || t("queue.unassigned");
  const lastActivity = workorder.lastActivityAt || workorder.updatedAt || workorder.createdAt;
  const displayLocale = variant === "mechanic" ? locale : undefined;
  const waiting = durationLabel(workorder.timeInStatusSeconds, displayLocale) || ageLabel(lastActivity, displayLocale);
  const statusLabel = formatLifecycleLabel(lifecycle, {
    openAsUnassigned: available,
    fallback: workorder.statusLabel || lifecycle,
  });
  const localizedStatusLabel = available && lifecycle === "open"
    ? t("status.unassigned")
    : STATUS_KEYS[lifecycle] ? t(STATUS_KEYS[lifecycle]) : statusLabel;
  const isSurveillance = variant === "surveillance";
  const hasOdooStage = ["closed", "odoo_entered"].includes(lifecycle);
  const rowStatus = isSurveillance && hasOdooStage
    ? (workorder.odooStatus === "entered" ? "odoo_entered" : workorder.odooStatus === "missing_info" ? "waiting_office" : "closed")
    : lifecycle;
  const rowStatusLabel = isSurveillance && hasOdooStage ? odooLabel(workorder.odooStatus) : localizedStatusLabel;
  const mobileMeta = workorderMobileMeta({ location: knownLocation, mechanic: knownMechanic });
  const openLabel = variant === "mechanic"
    ? `${t("queue.openWorkorder")} ${workorder.serial || unit}${workorder.concern ? `: ${workorder.concern}` : ""}`
    : workorderOpenLabel({ serial: workorder.serial, unit, concern: workorder.concern });

  return (
    <article className={`mechanic-work-row queue-row-${variant} ${workorder.unread ? "is-unread" : ""} ${featured ? "is-current" : ""}`}>
      <button className={`mechanic-work-open queue-variant-${variant}`} type="button" onClick={onOpen} aria-label={openLabel}>
        <span className="work-row-identity">
          <span className="work-row-unit"><strong>{unit}</strong>{workorder.unread ? <small className="queue-unread-label">{t("queue.new")}</small> : null}</span>
          <small>{workorder.serial}</small>
        </span>
        {isSurveillance ? (
          <>
            <span className="work-row-concern queue-wide-only">{workorder.concern || "Problem not recorded"}</span>
            <span className="work-row-location">{location}</span>
            <span className="work-row-mechanic">{mechanic}</span>
            {mobileMeta ? <span className="work-row-mobile-meta" aria-hidden="true">{mobileMeta}</span> : null}
            <span className="work-row-age queue-wide-only">{waiting || "Now"}</span>
            <span className="work-row-created">{formatUiDateTime(lastActivity)}</span>
          </>
        ) : (
          <>
            <span className="work-row-concern">{workorder.concern || t("queue.problemNotRecorded")}</span>
            {variant === "mechanic" ? <span className="work-row-location queue-wide-only">{location}</span> : null}
            {variant === "mechanic" ? <span className="work-row-mechanic queue-wide-only">{mechanic}</span> : null}
            {variant === "office" ? <span className="work-row-location">{location}</span> : null}
            {variant === "office" ? <span className="work-row-mechanic">{mechanic}</span> : null}
            {mobileMeta ? <span className="work-row-mobile-meta" aria-hidden="true">{mobileMeta}</span> : null}
            <WorkorderAttention reasons={attention} locale={locale} />
            {variant === "office" ? <span className="work-row-age">{waiting || t("queue.now")}</span> : <span className="work-row-created">{formatUiDateTime(workorder.createdAt, { locale })}</span>}
          </>
        )}
        <WorkorderStatusPill status={rowStatus} label={rowStatusLabel} />
        <ChevronRight className="work-row-chevron" />
      </button>
      {available ? (
        <button className="accept-work-button" type="button" onClick={onAccept} disabled={busy}>
          {busy ? busyLabel || t("queue.accepting") : acceptLabel || t("queue.acceptWork")}
        </button>
      ) : null}
    </article>
  );
}
