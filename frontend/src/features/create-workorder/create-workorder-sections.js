const WORK_FIELDS = new Set([
  "locationId",
  "mechanicConcern",
  "workEndDate",
  "workStartDate",
]);

const UNIT_FIELDS = new Set([
  "customerCompanyName",
  "licenseNo",
  "mileage",
  "model",
  "unitNo",
  "unitType",
  "vinNo",
]);

export function buildCreateWorkorderSections({ canAssign = true } = {}) {
  return [
    { id: "work", label: "Work" },
    { id: "unit", label: "Unit" },
    ...(canAssign ? [{ id: "assignment", label: "Assignment" }] : []),
    { id: "parts", label: "Parts" },
    { id: "preview", label: "Preview" },
  ];
}

export function createSectionForErrors(errors = {}) {
  const keys = Object.keys(errors).filter((key) => errors[key]);
  if (keys.some((key) => WORK_FIELDS.has(key))) return "work";
  if (keys.some((key) => UNIT_FIELDS.has(key))) return "unit";
  if (keys.some((key) => key === "parts")) return "parts";
  if (keys.some((key) => key === "mechanicUserIds")) return "assignment";
  return "";
}

export function isCreateErrorSectionReady({ activeSection, errors } = {}) {
  const errorSection = createSectionForErrors(errors);
  return !errorSection || errorSection === activeSection;
}
