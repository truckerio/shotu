import { invalidCreatePartIndex } from "../workorder-modules/parts/create-parts-model.js";

export const CREATE_WORKORDER_FIELD_IDS = Object.freeze({
  locationId: "workorder-location",
  unitNo: "workorder-unit",
  customerCompanyName: "customer-company-name",
  mechanicConcern: "workorder-concern",
  parts: "create-known-parts-editor",
});

export function validateCreateWorkorder(form = {}) {
  const invalidPartIndex = invalidCreatePartIndex(Array.isArray(form.parts) ? form.parts : []);
  return {
    ...(!String(form.locationId || "").trim() ? { locationId: "Select the repair location." } : {}),
    ...(!String(form.unitNo || "").trim() ? { unitNo: "Enter or select the unit." } : {}),
    ...(!String(form.customerCompanyName || "").trim()
      ? { customerCompanyName: "Enter the company that owns or operates this unit." }
      : {}),
    ...(!String(form.mechanicConcern || "").trim()
      ? { mechanicConcern: "Describe what needs to be inspected or repaired." }
      : {}),
    ...(invalidPartIndex >= 0 ? { parts: "Enter a valid quantity and unit for each known part." } : {}),
  };
}

export function createWorkorderSummaryErrors(errors = {}) {
  return Object.entries(errors).map(([key, message]) => ({
    id: CREATE_WORKORDER_FIELD_IDS[key] || "",
    key,
    message,
  }));
}
