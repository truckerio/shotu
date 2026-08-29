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

const DEFAULT_CREATE_SECTION_SEQUENCE = Object.freeze([
  WORKORDER_MODULE_IDS.UNIT,
  WORKORDER_MODULE_IDS.CONCERN,
  WORKORDER_MODULE_IDS.SCHEDULE,
  WORKORDER_MODULE_IDS.PARTS,
  WORKORDER_MODULE_IDS.LOCATION,
  WORKORDER_MODULE_IDS.ASSIGNMENT,
  WORKORDER_MODULE_IDS.PREVIEW,
]);

function orderBySequence(sections, sequence) {
  const rank = new Map(sequence.map((id, index) => [id, index]));
  return sections
    .map((section, index) => ({ section, index }))
    .sort((left, right) => (
      (rank.get(left.section.id) ?? Number.POSITIVE_INFINITY)
      - (rank.get(right.section.id) ?? Number.POSITIVE_INFINITY)
      || left.index - right.index
    ))
    .map(({ section }) => section);
}

export function defaultCreateWorkorderSection() {
  return WORKORDER_MODULE_IDS.UNIT;
}

export function buildCreateWorkorderSections({
  canAssign = true,
  includePreview = true,
  policyOverrides = [],
  role = canAssign ? "office" : "mechanic",
  userId = "",
} = {}) {
  const sequence = DEFAULT_CREATE_SECTION_SEQUENCE;
  const priorityById = new Map(sequence.map((id, index) => [id, sequence.length - index]));
  const coreSections = new Set(DEFAULT_CREATE_SECTION_SEQUENCE.slice(0, 4));
  const modules = workorderModuleDescriptors(WORKORDER_SURFACES.CREATE)
    .filter(({ id }) => includePreview || id !== WORKORDER_MODULE_IDS.PREVIEW)
    .filter(({ id }) => canAssign || id !== WORKORDER_MODULE_IDS.ASSIGNMENT)
    .map((descriptor) => {
      const id = descriptor.routeBySurface.create;
      return {
        id,
        label: descriptor.label,
        alwaysPrimary: coreSections.has(id),
        priority: priorityById.get(id) || 0,
        overflow: !coreSections.has(id) || undefined,
      };
    });

  const visibleModules = filterWorkorderModulesForPolicy(modules, {
    overrides: policyOverrides,
    role,
    surface: WORKORDER_SURFACES.CREATE,
    userId,
  }).filter((module) => module.id === WORKORDER_MODULE_IDS.PREVIEW || module.modulePolicy.canWrite);

  return orderBySequence(visibleModules, DEFAULT_CREATE_SECTION_SEQUENCE);
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
