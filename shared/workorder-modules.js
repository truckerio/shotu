export const WORKORDER_ACCESS_MODES = Object.freeze({
  HIDDEN: "hidden",
  READ: "read",
  WRITE: "write",
  REQUIRED: "required",
});

export const WORKORDER_INHERIT_ACCESS = "inherit";
export const WORKORDER_MODULE_CATALOG_VERSION = 1;

export const WORKORDER_SURFACES = Object.freeze({
  CREATE: "create",
  DETAIL: "detail",
});

export const WORKORDER_ROLES = Object.freeze([
  "mechanic",
  "office",
  "surveillance",
  "admin",
]);

export const WORKORDER_MODULES = Object.freeze([
  Object.freeze({
    key: "unit",
    owner: "workorders.unit",
    label: "Unit",
    description: "Truck, trailer, VIN, mileage, and model fields.",
    surfaces: Object.freeze(["create", "detail"]),
    capabilities: Object.freeze(["read", "write"]),
    actions: Object.freeze(["update"]),
    writeRolesBySurface: Object.freeze({ create: Object.freeze(["mechanic", "office", "admin"]), detail: Object.freeze(["office", "admin"]) }),
  }),
  Object.freeze({
    key: "location",
    owner: "workorders.location",
    label: "Location",
    description: "Repair yard and location-specific template.",
    surfaces: Object.freeze(["create", "detail"]),
    capabilities: Object.freeze(["read", "write"]),
    actions: Object.freeze(["update"]),
    writeRolesBySurface: Object.freeze({ create: Object.freeze(["mechanic", "office", "admin"]), detail: Object.freeze(["office", "admin"]) }),
  }),
  Object.freeze({
    key: "schedule",
    owner: "workorders.schedule",
    label: "Schedule",
    description: "Work dates, start time, and end time.",
    surfaces: Object.freeze(["create", "detail"]),
    capabilities: Object.freeze(["read", "write"]),
    actions: Object.freeze(["update"]),
    writeRolesBySurface: Object.freeze({ create: Object.freeze(["mechanic", "office", "admin"]), detail: Object.freeze(["office", "admin"]) }),
  }),
  Object.freeze({
    key: "assignment",
    owner: "workorders.assignment",
    label: "Assignment",
    description: "Mechanic assignment and reassignment controls.",
    surfaces: Object.freeze(["create", "detail"]),
    capabilities: Object.freeze(["read", "write"]),
    actions: Object.freeze(["accept", "release", "assign", "reassign", "update"]),
    writeRolesBySurface: Object.freeze({ create: Object.freeze(["office", "admin"]), detail: Object.freeze(["mechanic", "office", "admin"]) }),
    actionRoles: Object.freeze({
      accept: Object.freeze(["mechanic"]),
      release: Object.freeze(["mechanic"]),
      assign: Object.freeze(["office", "admin"]),
      reassign: Object.freeze(["office", "admin"]),
      update: Object.freeze(["office", "admin"]),
    }),
  }),
  Object.freeze({
    key: "concern",
    owner: "workorders.concern",
    label: "Concern",
    description: "Requested work and customer concern.",
    surfaces: Object.freeze(["create", "detail"]),
    capabilities: Object.freeze(["read", "write"]),
    actions: Object.freeze(["update"]),
    writeRolesBySurface: Object.freeze({ create: Object.freeze(["mechanic", "office", "admin"]), detail: Object.freeze(["office", "admin"]) }),
  }),
  Object.freeze({
    key: "diagnosisRepair",
    owner: "workorders.diagnosis-repair",
    label: "Diagnosis and repair",
    description: "Mechanic diagnosis and work performed.",
    surfaces: Object.freeze(["detail"]),
    capabilities: Object.freeze(["read", "write"]),
    actions: Object.freeze(["update"]),
    writeRolesBySurface: Object.freeze({ detail: Object.freeze(["mechanic", "admin"]) }),
  }),
  Object.freeze({
    key: "photos",
    owner: "workorders.photos",
    label: "Photos",
    description: "Workorder attachments and mechanic photos.",
    surfaces: Object.freeze(["detail"]),
    capabilities: Object.freeze(["read"]),
    actions: Object.freeze([]),
    writeRolesBySurface: Object.freeze({ detail: Object.freeze([]) }),
  }),
  Object.freeze({
    key: "parts",
    owner: "workorders.parts",
    label: "Parts",
    description: "Part requests, office review, and used parts.",
    surfaces: Object.freeze(["create", "detail"]),
    capabilities: Object.freeze(["read", "write"]),
    actions: Object.freeze(["request", "record", "approve", "decline", "allocate"]),
    writeRolesBySurface: Object.freeze({ create: Object.freeze(["mechanic", "office", "admin"]), detail: Object.freeze(["mechanic", "office", "admin"]) }),
    actionRoles: Object.freeze({
      request: Object.freeze(["mechanic"]),
      record: Object.freeze(["mechanic", "office", "admin"]),
      approve: Object.freeze(["office", "admin"]),
      decline: Object.freeze(["office", "admin"]),
      allocate: Object.freeze(["office", "admin"]),
    }),
  }),
  Object.freeze({
    key: "chat",
    owner: "workorders.chat",
    label: "Chat and office help",
    description: "Messages between mechanic, office, and surveillance.",
    surfaces: Object.freeze(["detail"]),
    capabilities: Object.freeze(["read", "write"]),
    actions: Object.freeze(["send", "attach", "acknowledge"]),
    writeRolesBySurface: Object.freeze({ detail: Object.freeze(["mechanic", "office", "admin"]) }),
  }),
  Object.freeze({
    key: "activity",
    owner: "workorders.activity",
    label: "Activity",
    description: "Audit history and lifecycle events.",
    surfaces: Object.freeze(["detail"]),
    capabilities: Object.freeze(["read"]),
    actions: Object.freeze([]),
    writeRolesBySurface: Object.freeze({ detail: Object.freeze([]) }),
  }),
  Object.freeze({
    key: "preview",
    owner: "workorders.preview",
    label: "Preview and print",
    description: "Customer-facing workorder document.",
    surfaces: Object.freeze(["create", "detail"]),
    capabilities: Object.freeze(["read"]),
    actions: Object.freeze([]),
    writeRolesBySurface: Object.freeze({ create: Object.freeze([]), detail: Object.freeze([]) }),
    writeRolesBySurface: Object.freeze({ detail: Object.freeze([]) }),
  }),
  Object.freeze({
    key: "completion",
    owner: "workorders.completion",
    label: "Completion",
    description: "Work done, close, cancel, and review actions.",
    surfaces: Object.freeze(["detail"]),
    capabilities: Object.freeze(["read", "write"]),
    actions: Object.freeze(["markWorkDone", "close", "cancel", "requestChanges"]),
    writeRolesBySurface: Object.freeze({ detail: Object.freeze(["mechanic", "office", "admin"]) }),
    actionRoles: Object.freeze({
      markWorkDone: Object.freeze(["mechanic", "office", "admin"]),
      close: Object.freeze(["office", "admin"]),
      cancel: Object.freeze(["office", "admin"]),
      requestChanges: Object.freeze(["office", "admin"]),
    }),
  }),
  Object.freeze({
    key: "odoo",
    owner: "integrations.odoo",
    label: "Odoo",
    description: "Odoo readiness, missing info, and entry state.",
    surfaces: Object.freeze(["detail"]),
    capabilities: Object.freeze(["read", "write"]),
    actions: Object.freeze(["prepare", "createDraft", "markMissingInfo"]),
    writeRolesBySurface: Object.freeze({ detail: Object.freeze(["mechanic", "office", "surveillance", "admin"]) }),
    actionRoles: Object.freeze({
      prepare: Object.freeze(["mechanic", "office", "surveillance", "admin"]),
      createDraft: Object.freeze(["mechanic", "office", "surveillance", "admin"]),
      markMissingInfo: Object.freeze(["mechanic", "office", "surveillance", "admin"]),
    }),
  }),
]);

const DEFAULT_ACCESS = Object.freeze({
  mechanic: Object.freeze({
    create: Object.freeze({
      unit: "write",
      location: "write",
      schedule: "write",
      assignment: "hidden",
      concern: "required",
      parts: "write",
      preview: "read",
    }),
    detail: Object.freeze({
      unit: "read",
      location: "read",
      schedule: "read",
      assignment: "write",
      concern: "read",
      diagnosisRepair: "write",
      photos: "read",
      parts: "write",
      chat: "write",
      activity: "read",
      preview: "read",
      completion: "write",
      odoo: "hidden",
    }),
  }),
  office: Object.freeze({
    create: Object.freeze({
      unit: "write",
      location: "required",
      schedule: "write",
      assignment: "write",
      concern: "required",
      parts: "write",
      preview: "read",
    }),
    detail: Object.freeze({
      unit: "write",
      location: "write",
      schedule: "write",
      assignment: "write",
      concern: "write",
      diagnosisRepair: "write",
      photos: "read",
      parts: "write",
      chat: "write",
      activity: "read",
      preview: "read",
      completion: "write",
      odoo: "hidden",
    }),
  }),
  surveillance: Object.freeze({
    create: Object.freeze({
      unit: "hidden",
      location: "hidden",
      schedule: "hidden",
      assignment: "hidden",
      concern: "hidden",
      parts: "hidden",
      preview: "hidden",
    }),
    detail: Object.freeze({
      unit: "read",
      location: "read",
      schedule: "read",
      assignment: "read",
      concern: "read",
      diagnosisRepair: "write",
      photos: "read",
      parts: "read",
      chat: "read",
      activity: "read",
      preview: "read",
      completion: "read",
      odoo: "write",
    }),
  }),
  admin: Object.freeze({
    create: Object.freeze({
      unit: "write",
      location: "required",
      schedule: "write",
      assignment: "write",
      concern: "required",
      parts: "write",
      preview: "read",
    }),
    detail: Object.freeze({
      unit: "write",
      location: "write",
      schedule: "write",
      assignment: "write",
      concern: "write",
      diagnosisRepair: "write",
      photos: "read",
      parts: "write",
      chat: "write",
      activity: "read",
      preview: "read",
      completion: "write",
      odoo: "write",
    }),
  }),
});

const VALID_ACCESS_MODES = new Set(Object.values(WORKORDER_ACCESS_MODES));
const MODULES_BY_KEY = new Map(WORKORDER_MODULES.map((module) => [module.key, module]));

export function getWorkorderModule(moduleKey) {
  return MODULES_BY_KEY.get(moduleKey) || null;
}

export function workorderModuleCatalog() {
  return {
    version: WORKORDER_MODULE_CATALOG_VERSION,
    accessModes: Object.values(WORKORDER_ACCESS_MODES),
    roles: [...WORKORDER_ROLES],
    surfaces: Object.values(WORKORDER_SURFACES),
    modules: WORKORDER_MODULES.map((module) => ({ ...module })),
  };
}

function explicitAccess(input, role, surface, moduleKey) {
  const candidate = input?.[role]?.[surface]?.[moduleKey];
  return VALID_ACCESS_MODES.has(candidate) ? candidate : null;
}

export function normalizeModuleAccessOverrides(input = {}) {
  const output = {};
  for (const role of WORKORDER_ROLES) {
    const roleAccess = {};
    for (const surface of Object.values(WORKORDER_SURFACES)) {
      const surfaceAccess = {};
      for (const module of WORKORDER_MODULES) {
        if (!module.surfaces.includes(surface)) continue;
        const candidate = input?.[role]?.[surface]?.[module.key];
        if (VALID_ACCESS_MODES.has(candidate)) surfaceAccess[module.key] = candidate;
      }
      if (Object.keys(surfaceAccess).length) roleAccess[surface] = surfaceAccess;
    }
    if (Object.keys(roleAccess).length) output[role] = roleAccess;
  }
  return output;
}

export function defaultWorkorderModuleAccess(role, surface, moduleKey) {
  return DEFAULT_ACCESS[role]?.[surface]?.[moduleKey] || WORKORDER_ACCESS_MODES.HIDDEN;
}

export function normalizeModuleAccessMap(input = {}) {
  const output = {};
  for (const role of WORKORDER_ROLES) {
    const roleInput = input?.[role] || {};
    output[role] = {};
    for (const surface of Object.values(WORKORDER_SURFACES)) {
      const surfaceInput = roleInput?.[surface] || {};
      output[role][surface] = {};
      for (const module of WORKORDER_MODULES) {
        if (!module.surfaces.includes(surface)) continue;
        const candidate = surfaceInput[module.key];
        output[role][surface][module.key] = VALID_ACCESS_MODES.has(candidate)
          ? candidate
          : defaultWorkorderModuleAccess(role, surface, module.key);
      }
    }
  }
  return output;
}

export function normalizeUserModuleAccessMap(input = {}) {
  const output = {};
  for (const [userId, userInput] of Object.entries(input || {})) {
    const userAccess = {};
    for (const surface of Object.values(WORKORDER_SURFACES)) {
      const surfaceInput = userInput?.[surface] || {};
      const surfaceAccess = {};
      for (const module of WORKORDER_MODULES) {
        if (!module.surfaces.includes(surface)) continue;
        const candidate = surfaceInput[module.key];
        if (VALID_ACCESS_MODES.has(candidate)) surfaceAccess[module.key] = candidate;
      }
      if (Object.keys(surfaceAccess).length) userAccess[surface] = surfaceAccess;
    }
    if (Object.keys(userAccess).length) output[userId] = userAccess;
  }
  return output;
}

export function resolveWorkorderModuleAccess({ role, surface, moduleKey, policy = null, userId = "" }) {
  const userAccess = normalizeUserModuleAccessMap(policy?.userModuleAccess || policy?.user_module_access || {});
  const userOverride = userId ? userAccess[userId]?.[surface]?.[moduleKey] : null;
  if (VALID_ACCESS_MODES.has(userOverride)) return userOverride;
  const normalized = normalizeModuleAccessMap(policy?.moduleAccess || policy?.module_access || {});
  return normalized[role]?.[surface]?.[moduleKey] || defaultWorkorderModuleAccess(role, surface, moduleKey);
}

export function resolveEffectiveWorkorderModuleAccess({
  role,
  surface,
  moduleKey,
  companyPolicy = null,
  locationPolicy = null,
  userId = "",
}) {
  const module = getWorkorderModule(moduleKey);
  if (!module || !module.surfaces.includes(surface) || !WORKORDER_ROLES.includes(role)) {
    return { access: WORKORDER_ACCESS_MODES.HIDDEN, source: "default" };
  }

  const userAccess = normalizeUserModuleAccessMap(
    locationPolicy?.userModuleAccess || locationPolicy?.user_module_access || {},
  );
  const userOverride = userId ? userAccess[userId]?.[surface]?.[moduleKey] : null;
  if (VALID_ACCESS_MODES.has(userOverride)) return { access: userOverride, source: "user" };

  const companyUserAccess = normalizeUserModuleAccessMap(
    companyPolicy?.userModuleAccess || companyPolicy?.user_module_access || {},
  );
  const companyUserOverride = userId ? companyUserAccess[userId]?.[surface]?.[moduleKey] : null;
  if (VALID_ACCESS_MODES.has(companyUserOverride)) {
    return { access: companyUserOverride, source: "company_user" };
  }

  const locationOverrides = normalizeModuleAccessOverrides(
    locationPolicy?.moduleAccessOverrides
      || locationPolicy?.module_access_overrides
      || locationPolicy?.moduleAccess
      || locationPolicy?.module_access
      || {},
  );
  const locationOverride = explicitAccess(locationOverrides, role, surface, moduleKey);
  if (locationOverride) return { access: locationOverride, source: "location" };

  const companyOverrides = normalizeModuleAccessOverrides(
    companyPolicy?.moduleAccess || companyPolicy?.module_access || {},
  );
  const companyOverride = explicitAccess(companyOverrides, role, surface, moduleKey);
  if (companyOverride) return { access: companyOverride, source: "company" };

  return {
    access: defaultWorkorderModuleAccess(role, surface, moduleKey),
    source: "default",
  };
}

export function canAccessWorkorderModule(options) {
  return resolveWorkorderModuleAccess(options) !== WORKORDER_ACCESS_MODES.HIDDEN;
}

export function canWriteWorkorderModule(options) {
  const access = resolveWorkorderModuleAccess(options);
  return access === WORKORDER_ACCESS_MODES.WRITE || access === WORKORDER_ACCESS_MODES.REQUIRED;
}

export function canCreateWorkorderForRole(role, policy = null, userId = "") {
  const createModules = WORKORDER_MODULES.filter((module) => module.surfaces.includes(WORKORDER_SURFACES.CREATE));
  return createModules.some((module) => canWriteWorkorderModule({
    role,
    surface: WORKORDER_SURFACES.CREATE,
    moduleKey: module.key,
    policy,
    userId,
  }));
}
