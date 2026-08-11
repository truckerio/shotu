export const ODOO_ELIGIBLE_STATUSES = Object.freeze(["closed", "odoo_entered"]);

export function isWorkorderOdooEligible(status) {
  return ODOO_ELIGIBLE_STATUSES.includes(status);
}

export function missingOdooWorkorderFields(workorder = {}) {
  return [
    !workorder.concern ? "Concern" : "",
    !workorder.diagnosis ? "Diagnosis" : "",
    !workorder.workPerformed ? "Work performed" : "",
    !workorder.asset?.unitNo && !workorder.asset?.name ? "Unit" : "",
    !(workorder.mechanics?.length || workorder.mechanic?.name) ? "Mechanic" : "",
  ].filter(Boolean);
}

export function odooReadinessStatus({ created = false, loading, readiness }) {
  if (created) return "Draft created";
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

export function odooServiceOrderRecordUrl(recordUrl, actionId) {
  const action = String(actionId || "").trim();
  if (!recordUrl || !/^[1-9][0-9]*$/.test(action)) return recordUrl || "";
  try {
    const url = new URL(recordUrl);
    const params = new URLSearchParams(url.hash.replace(/^#/, ""));
    params.set("action", action);
    url.hash = params.toString();
    return url.toString();
  } catch {
    return recordUrl;
  }
}

function eventTime(event) {
  const value = new Date(event?.created_at || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function workorderMissingInfoHandoff(workorder, timeline = []) {
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
