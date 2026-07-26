export const CREATE_WORKORDER_FIELD_IDS = Object.freeze({
  locationId: "workorder-location",
  unitNo: "workorder-unit",
  customerCompanyName: "customer-company-name",
  mechanicConcern: "workorder-concern",
});

export function validateCreateWorkorder(form = {}) {
  return {
    ...(!String(form.locationId || "").trim() ? { locationId: "Select the repair location." } : {}),
    ...(!String(form.unitNo || "").trim() ? { unitNo: "Enter or select the unit." } : {}),
    ...(!String(form.customerCompanyName || "").trim()
      ? { customerCompanyName: "Enter the company that owns or operates this unit." }
      : {}),
    ...(!String(form.mechanicConcern || "").trim()
      ? { mechanicConcern: "Describe what needs to be inspected or repaired." }
      : {}),
  };
}

export function createWorkorderSummaryErrors(errors = {}) {
  return Object.entries(errors).map(([key, message]) => ({
    id: CREATE_WORKORDER_FIELD_IDS[key] || "",
    key,
    message,
  }));
}
