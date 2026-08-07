import {
  SURVEILLANCE_PHONE_PRIMARY_TABS,
} from "../surveillanceQueue.js";

export const SURVEILLANCE_QUEUE_DEFINITIONS = [
  { key: "active", label: "Active", icon: "clock" },
  { key: "awaitingOffice", label: "Awaiting office", icon: "complete" },
  { key: "pendingOdoo", label: "Needs Odoo", icon: "odoo" },
  { key: "missingInfo", label: "Missing info", icon: "missing" },
  { key: "entered", label: "Entered", icon: "complete" },
];

export const SURVEILLANCE_QUEUE_KEYS = SURVEILLANCE_QUEUE_DEFINITIONS.map(({ key }) => key);

export function localDate(value) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function matchesDateFilter(value, startDate, endDate) {
  if (!startDate && !endDate) return true;
  const date = localDate(value);
  if (!date) return false;
  if (startDate && endDate) {
    const rangeStart = startDate <= endDate ? startDate : endDate;
    const rangeEnd = startDate <= endDate ? endDate : startDate;
    return date >= rangeStart && date <= rangeEnd;
  }
  if (startDate) return date === startDate;
  return date <= endDate;
}

export function dateInputValue(date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function datePresetRange(preset, today = new Date()) {
  if (preset === "today") {
    const value = dateInputValue(today);
    return { start: value, end: value };
  }
  if (preset === "week") {
    const start = new Date(today);
    const day = start.getDay();
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
    return { start: dateInputValue(start), end: dateInputValue(today) };
  }
  return null;
}

export function activeDatePreset(startDate, endDate, today = new Date()) {
  if (!startDate && !endDate) return "all";
  const todayRange = datePresetRange("today", today);
  if (startDate === todayRange.start && endDate === todayRange.end) return "today";
  const week = datePresetRange("week", today);
  if (startDate === week.start && endDate === week.end) return "week";
  return "custom";
}

export function buildSurveillanceTabs(counts = {}, iconByType = {}) {
  return SURVEILLANCE_QUEUE_DEFINITIONS.map(({ key, label, icon }) => ({
    key,
    label,
    count: counts[key] || 0,
    icon: iconByType[icon],
  }));
}

export function buildCompactSurveillanceTabs(tabs) {
  return SURVEILLANCE_PHONE_PRIMARY_TABS.map((phoneTab) => ({
    ...tabs.find(({ key }) => key === phoneTab.key),
    label: phoneTab.label,
  }));
}

export function allSurveillanceRows(dashboard) {
  return SURVEILLANCE_QUEUE_KEYS.flatMap((key) => dashboard?.[key] || []);
}

export function surveillanceLocations(dashboard) {
  return [...new Set(allSurveillanceRows(dashboard).map((row) => row.locationName).filter(Boolean))].sort();
}

export function missingFields(workorder) {
  return [
    !workorder.concern ? "Concern" : "",
    !workorder.diagnosis ? "Diagnosis" : "",
    !workorder.workPerformed ? "Work performed" : "",
    !workorder.asset?.unitNo && !workorder.asset?.name ? "Unit" : "",
    !(workorder.mechanics?.length || workorder.mechanic?.name) ? "Mechanic" : "",
  ].filter(Boolean);
}

export function odooReadinessStatus({ loading, readiness }) {
  if (loading && !readiness) return "Checking Odoo";
  return readiness?.ready ? "Ready to create draft" : "Needs setup";
}

export function odooDraftBlockedMessage(readiness) {
  if (readiness?.ready !== false) return "";
  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers : [];
  if (blockers.length === 1 && blockers[0]?.message) {
    return `Resolve this Odoo blocker and try again: ${blockers[0].message}`;
  }
  if (blockers.length > 1) {
    return `Resolve the ${blockers.length} Odoo blockers shown above and try again.`;
  }
  return "Odoo readiness could not be confirmed. Refresh the workorder and try again.";
}

export function progressTimestamp(workorder) {
  if (workorder.status === "accepted") return { label: "Accepted", value: workorder.acceptedAt };
  if (workorder.status === "in_progress") return { label: "Started", value: workorder.startedAt || workorder.acceptedAt };
  if (workorder.status === "mechanic_done") return { label: "Work done", value: workorder.mechanicDoneAt };
  return { label: "Approved", value: workorder.closedAt };
}
