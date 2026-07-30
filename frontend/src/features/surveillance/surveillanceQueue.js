export const SURVEILLANCE_PHONE_PRIMARY_TABS = [
  { key: "pendingOdoo", label: "Needs Odoo" },
  { key: "entered", label: "Entered" },
  { key: "missingInfo", label: "Missing info" },
];

export const SURVEILLANCE_PHONE_SECONDARY_TABS = [
  { key: "active", label: "Active work" },
  { key: "awaitingOffice", label: "Awaiting office" },
];

export function isSurveillancePhonePrimaryTab(tab) {
  return SURVEILLANCE_PHONE_PRIMARY_TABS.some(({ key }) => key === tab);
}

function eventTime(event) {
  const value = new Date(event?.created_at || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function surveillanceMissingInfoHandoff(workorder, timeline = []) {
  const events = Array.isArray(timeline) ? timeline : [];
  const missingInfoActive = workorder?.odooStatus === "missing_info"
    || workorder?.attentionReasons?.includes("missing_info");
  if (!missingInfoActive) return null;

  const request = [...events]
    .reverse()
    .find((event) => event.type === "attention"
      && event.field_key === "missing_info"
      && event.action !== "resolved");
  const requestTime = eventTime(request);
  const managerUpdate = [...events]
    .reverse()
    .find((event) => eventTime(event) > requestTime
      && ["office", "admin"].includes(event.actor_role)
      && event.type !== "access");

  return {
    requestedBy: request?.changed_by_name || "Surveillance",
    requestedAt: request?.created_at || "",
    note: request?.note || "Information is required before Odoo entry.",
    managerUpdate: managerUpdate ? {
      by: managerUpdate.changed_by_name || "Manager",
      at: managerUpdate.created_at || "",
      note: managerUpdate.note || managerUpdate.field_label || "Workorder information updated.",
    } : null,
  };
}
