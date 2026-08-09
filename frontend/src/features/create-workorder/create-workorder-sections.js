import {
  filterWorkorderModulesForPolicy,
  WORKORDER_MODULE_IDS,
  WORKORDER_SURFACES,
  workorderModuleDescriptors,
} from "../workorder-modules/workorder-module-registry.js";

const UNIT_FIELDS = new Set([
  "customerCompanyName",
  "licenseNo",
  "mileage",
  "model",
  "unitNo",
  "unitType",
  "vinNo",
]);

export function buildCreateWorkorderSections({
  canAssign = true,
  includePreview = true,
  policyOverrides = [],
  role = canAssign ? "office" : "mechanic",
  userId = "",
} = {}) {
  const modules = workorderModuleDescriptors(WORKORDER_SURFACES.CREATE)
    .filter(({ id }) => includePreview || id !== WORKORDER_MODULE_IDS.PREVIEW)
    .filter(({ id }) => canAssign || id !== WORKORDER_MODULE_IDS.ASSIGNMENT)
    .map((descriptor) => ({ id: descriptor.routeBySurface.create, label: descriptor.label }));

  return filterWorkorderModulesForPolicy(modules, {
    overrides: policyOverrides,
    role,
    surface: WORKORDER_SURFACES.CREATE,
    userId,
  }).filter((module) => module.id === WORKORDER_MODULE_IDS.PREVIEW || module.modulePolicy.canWrite);
}

export function createSectionForErrors(errors = {}) {
  const keys = Object.keys(errors).filter((key) => errors[key]);
  if (keys.includes("locationId")) return "location";
  if (keys.some((key) => ["workEndDate", "workStartDate"].includes(key))) return "schedule";
  if (keys.includes("mechanicConcern")) return "concern";
  if (keys.some((key) => UNIT_FIELDS.has(key))) return "unit";
  if (keys.some((key) => key === "parts")) return "parts";
  if (keys.some((key) => key === "mechanicUserIds")) return "assignment";
  return "";
}

export function isCreateErrorSectionReady({ activeSection, errors } = {}) {
  const errorSection = createSectionForErrors(errors);
  return !errorSection || errorSection === activeSection;
}
