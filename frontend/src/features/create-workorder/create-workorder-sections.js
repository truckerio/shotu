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

const CREATE_SECTION_PRIORITY = Object.freeze([
  WORKORDER_MODULE_IDS.LOCATION,
  WORKORDER_MODULE_IDS.SCHEDULE,
  WORKORDER_MODULE_IDS.CONCERN,
  WORKORDER_MODULE_IDS.UNIT,
  WORKORDER_MODULE_IDS.ASSIGNMENT,
  WORKORDER_MODULE_IDS.PARTS,
]);

const CREATE_SECTION_PRIORITY_BY_ID = new Map(
  CREATE_SECTION_PRIORITY.map((id, index) => [id, CREATE_SECTION_PRIORITY.length - index]),
);

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
    .map((descriptor) => {
      const id = descriptor.routeBySurface.create;
      return {
        id,
        label: descriptor.label,
        alwaysPrimary: CREATE_SECTION_PRIORITY_BY_ID.has(id),
        priority: CREATE_SECTION_PRIORITY_BY_ID.get(id) || 0,
        overflow: descriptor.placementBySurface?.create === "supporting",
      };
    });

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
