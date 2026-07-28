import {
  DEFAULT_UOM_CODE,
  getUnitDefinition,
  normalizeQuantity,
} from "../../../../shared/units-of-measure.js";

export const CREATE_WORKORDER_FIELD_IDS = Object.freeze({
  locationId: "workorder-location",
  unitNo: "workorder-unit",
  customerCompanyName: "customer-company-name",
  mechanicConcern: "workorder-concern",
  parts: "known-part-quantity-0",
});

export function validateCreateWorkorder(form = {}) {
  const invalidPart = (Array.isArray(form.parts) ? form.parts : []).find((part) => {
    const hasContent = Boolean(part?.partNo || part?.qty || part?.repairOrder);
    if (!hasContent) return false;
    const code = String(part?.uomCode || DEFAULT_UOM_CODE).trim().toLowerCase();
    return !getUnitDefinition(code) || !normalizeQuantity(part?.qty, code);
  });
  return {
    ...(!String(form.locationId || "").trim() ? { locationId: "Select the repair location." } : {}),
    ...(!String(form.unitNo || "").trim() ? { unitNo: "Enter or select the unit." } : {}),
    ...(!String(form.customerCompanyName || "").trim()
      ? { customerCompanyName: "Enter the company that owns or operates this unit." }
      : {}),
    ...(!String(form.mechanicConcern || "").trim()
      ? { mechanicConcern: "Describe what needs to be inspected or repaired." }
      : {}),
    ...(invalidPart ? { parts: "Enter a valid quantity and unit for each known part." } : {}),
  };
}

export function createWorkorderSummaryErrors(errors = {}) {
  return Object.entries(errors).map(([key, message]) => ({
    id: CREATE_WORKORDER_FIELD_IDS[key] || "",
    key,
    message,
  }));
}
