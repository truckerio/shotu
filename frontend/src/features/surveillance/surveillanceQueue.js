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

export { workorderMissingInfoHandoff as surveillanceMissingInfoHandoff } from "../workorder-modules/odoo/workorder-odoo-model.js";
