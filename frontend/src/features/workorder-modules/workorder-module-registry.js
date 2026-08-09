import {
  WORKORDER_ACCESS_MODES as SHARED_ACCESS_MODES,
  WORKORDER_MODULES as SHARED_MODULES,
  WORKORDER_SURFACES as SHARED_SURFACES,
  defaultWorkorderModuleAccess as sharedDefaultModuleAccess,
} from "../../../../shared/workorder-modules.js";

import { activityModuleManifest } from "./activity/manifest.js";
import { assignmentModuleManifest } from "./assignment/manifest.js";
import { chatModuleManifest } from "./chat/manifest.js";
import { completionModuleManifest } from "./completion/manifest.js";
import { diagnosisRepairModuleManifest } from "./diagnosis-repair/manifest.js";
import { locationModuleManifest } from "./location/manifest.js";
import { odooModuleManifest } from "./odoo/manifest.js";
import { partsModuleManifest } from "./parts/manifest.js";
import { photosModuleManifest } from "./photos/manifest.js";
import { previewModuleManifest } from "./preview/manifest.js";
import { scheduleModuleManifest } from "./schedule/manifest.js";
import { unitModuleManifest } from "./unit/manifest.js";
import { concernModuleManifest } from "./work/manifest.js";

export const WORKORDER_SURFACES = Object.freeze({
  ...SHARED_SURFACES,
  // Queue presentation is intentionally frontend-only until it has a shared
  // authorization contract. It must not invent backend access defaults.
  QUEUE: "queue",
});

export const WORKORDER_MODULE_ACCESS = Object.freeze({
  ...SHARED_ACCESS_MODES,
  // Backwards-compatible name for old callers. The effective access remains
  // the canonical shared "write" value.
  ACTION: SHARED_ACCESS_MODES.WRITE,
});

export const WORKORDER_MODULE_IDS = Object.freeze({
  WORK: "work",
  UNIT: "unit",
  LOCATION: "location",
  SCHEDULE: "schedule",
  ASSIGNMENT: "assignment",
  CONCERN: "concern",
  DIAGNOSIS: "diagnosis",
  DIAGNOSIS_REPAIR: "diagnosisRepair",
  PHOTOS: "photos",
  PARTS: "parts",
  CHAT: "chat",
  ACTIVITY: "activity",
  PREVIEW: "preview",
  COMPLETION: "completion",
  TEAM: "team",
  ODOO: "odoo",
});

const FRONTEND_MANIFESTS = [
  unitModuleManifest,
  locationModuleManifest,
  scheduleModuleManifest,
  assignmentModuleManifest,
  concernModuleManifest,
  diagnosisRepairModuleManifest,
  photosModuleManifest,
  chatModuleManifest,
  partsModuleManifest,
  activityModuleManifest,
  previewModuleManifest,
  completionModuleManifest,
  odooModuleManifest,
];

const sharedByKey = new Map(SHARED_MODULES.map((module) => [module.key, module]));

function canonicalDescriptor(module) {
  return Object.freeze({
    id: module.key,
    policyKey: module.key,
    label: module.label,
    description: module.description,
    surfaces: module.surfaces,
    routeBySurface: Object.freeze({}),
    orderBySurface: Object.freeze({}),
    compactPlacement: Object.freeze({}),
    placementBySurface: Object.freeze({}),
  });
}

function frontendDescriptor(manifest) {
  const canonical = sharedByKey.get(manifest.policyKey);
  return Object.freeze({
    description: canonical?.description || "",
    surfaces: canonical?.surfaces || Object.keys(manifest.routeBySurface || {}),
    ...manifest,
  });
}

export const WORKORDER_MODULE_REGISTRY = Object.freeze({
  ...Object.fromEntries(SHARED_MODULES.map((module) => [module.key, canonicalDescriptor(module)])),
  ...Object.fromEntries(FRONTEND_MANIFESTS.map((manifest) => [manifest.id, frontendDescriptor(manifest)])),
});

export const WORKORDER_MODULE_ALIASES = Object.freeze({
  work: WORKORDER_MODULE_IDS.CONCERN,
  team: WORKORDER_MODULE_IDS.ASSIGNMENT,
  diagnosis: WORKORDER_MODULE_IDS.DIAGNOSIS_REPAIR,
});

const VALID_ACCESS = new Set(Object.values(SHARED_ACCESS_MODES));

function normalizeRole(role) {
  return role === "manager" ? "office" : role || "office";
}

export function workorderModuleDescriptor(moduleId) {
  const canonicalId = WORKORDER_MODULE_ALIASES[moduleId] || moduleId;
  const descriptor = WORKORDER_MODULE_REGISTRY[canonicalId] || null;
  if (!descriptor || canonicalId === moduleId) return descriptor;
  return Object.freeze({ ...descriptor, id: moduleId, policyKey: canonicalId, routeBySurface: Object.freeze({}) });
}

export function workorderModuleDescriptors(surface) {
  return Object.values(WORKORDER_MODULE_REGISTRY)
    .filter((descriptor) => descriptor.policyKey === descriptor.id && descriptor.routeBySurface?.[surface])
    .sort((left, right) => (left.orderBySurface?.[surface] ?? 1000) - (right.orderBySurface?.[surface] ?? 1000));
}

function normalizedPolicyValue(value) {
  if (VALID_ACCESS.has(value)) return { access: value, actions: {} };
  if (value && typeof value === "object" && VALID_ACCESS.has(value.access)) {
    return { access: value.access, actions: value.actions || {} };
  }
  return null;
}

function surfacePolicyValue(surfacePolicy, descriptor) {
  return normalizedPolicyValue(surfacePolicy?.[descriptor.id])
    || normalizedPolicyValue(surfacePolicy?.[descriptor.policyKey]);
}

function objectPolicyOverride(overrides, { descriptor, role, surface, userId }) {
  if (!overrides || Array.isArray(overrides) || typeof overrides !== "object") return null;
  const userAccess = overrides.userModuleAccess || overrides.user_module_access;
  const userOverride = userId
    ? surfacePolicyValue(userAccess?.[userId]?.[surface], descriptor)
    : null;
  if (userOverride) return userOverride;

  const roleAccess = overrides.moduleAccess || overrides.module_access || overrides;
  return surfacePolicyValue(roleAccess?.[normalizeRole(role)]?.[surface], descriptor);
}

function arrayPolicyOverride(overrides, { descriptor, role, surface, userId }) {
  if (!Array.isArray(overrides)) return null;
  const normalizedRole = normalizeRole(role);
  let roleOverride = null;
  let userOverride = null;

  for (const entry of overrides) {
    if (!entry || entry.surface !== surface) continue;
    if (![descriptor.id, descriptor.policyKey].includes(entry.moduleId || entry.moduleKey)) continue;
    const value = normalizedPolicyValue(entry);
    if (!value) continue;
    if (entry.userId && userId && entry.userId === userId) userOverride = value;
    if (!entry.userId && entry.role && normalizeRole(entry.role) === normalizedRole) roleOverride = value;
  }

  return userOverride || roleOverride;
}

function supportsSharedSurface(descriptor, surface) {
  return sharedByKey.get(descriptor.policyKey)?.surfaces.includes(surface) || false;
}

export function defaultWorkorderModuleAccess({ moduleId, role, surface }) {
  const descriptor = workorderModuleDescriptor(moduleId);
  if (!descriptor) return WORKORDER_MODULE_ACCESS.HIDDEN;
  if (supportsSharedSurface(descriptor, surface)) {
    return sharedDefaultModuleAccess(normalizeRole(role), surface, descriptor.policyKey);
  }
  return descriptor.legacyAccessBySurface?.[surface] || WORKORDER_MODULE_ACCESS.HIDDEN;
}

export function resolveWorkorderModulePolicy({
  moduleId,
  role,
  surface,
  userId = "",
  overrides = null,
} = {}) {
  const descriptor = workorderModuleDescriptor(moduleId);
  if (!descriptor) {
    return {
      access: WORKORDER_MODULE_ACCESS.HIDDEN,
      actions: {},
      canRead: false,
      canWrite: false,
      descriptor: null,
      moduleId,
      policyKey: moduleId,
      readOnly: false,
      role: normalizeRole(role),
      surface,
      visible: false,
    };
  }

  const override = arrayPolicyOverride(overrides, { descriptor, role, surface, userId })
    || objectPolicyOverride(overrides, { descriptor, role, surface, userId });
  const access = override?.access || defaultWorkorderModuleAccess({ moduleId, role, surface });
  const visible = access !== WORKORDER_MODULE_ACCESS.HIDDEN;
  const canWrite = access === WORKORDER_MODULE_ACCESS.WRITE
    || access === WORKORDER_MODULE_ACCESS.REQUIRED;

  return {
    access,
    actions: override?.actions || {},
    canRead: visible,
    canWrite,
    descriptor,
    moduleId,
    policyKey: descriptor.policyKey,
    readOnly: visible && !canWrite,
    role: normalizeRole(role),
    surface,
    visible,
  };
}

export function filterWorkorderModulesForPolicy(modules, context = {}) {
  return modules.flatMap((module) => {
    const modulePolicy = resolveWorkorderModulePolicy({
      ...context,
      moduleId: module.moduleId || module.id,
    });
    return modulePolicy.visible
      ? [{ ...module, access: modulePolicy.access, modulePolicy }]
      : [];
  });
}

export function orderWorkorderModules(modules, { compact = false, role = "office", surface } = {}) {
  const normalizedRole = normalizeRole(role);
  return modules
    .map((module, index) => ({ module, index }))
    .sort((left, right) => {
      const leftDescriptor = workorderModuleDescriptor(left.module.id);
      const rightDescriptor = workorderModuleDescriptor(right.module.id);
      if (compact) {
        const placementRank = { primary: 0, overflow: 1 };
        const leftPlacement = placementRank[leftDescriptor?.compactPlacement?.[normalizedRole]] ?? 2;
        const rightPlacement = placementRank[rightDescriptor?.compactPlacement?.[normalizedRole]] ?? 2;
        if (leftPlacement !== rightPlacement) return leftPlacement - rightPlacement;
      }
      const leftOrder = leftDescriptor?.orderBySurface?.[surface] ?? 1000;
      const rightOrder = rightDescriptor?.orderBySurface?.[surface] ?? 1000;
      return leftOrder - rightOrder || left.index - right.index;
    })
    .map(({ module }) => {
      if (!compact) return module;
      const placement = workorderModuleDescriptor(module.id)?.compactPlacement?.[normalizedRole];
      return placement === "overflow" ? { ...module, overflow: true } : { ...module, overflow: undefined };
    });
}

export function resolveWorkorderModuleNavigation(modules, context = {}) {
  return orderWorkorderModules(filterWorkorderModulesForPolicy(modules, context), context);
}

export function workorderModuleRouteIds(surface) {
  return workorderModuleDescriptors(surface)
    .map((descriptor) => descriptor.routeBySurface[surface])
    .filter((routeId, index, all) => routeId && all.indexOf(routeId) === index);
}

export function workorderModuleLabel(moduleId, fallback = "") {
  return workorderModuleDescriptor(moduleId)?.label || fallback || moduleId;
}
