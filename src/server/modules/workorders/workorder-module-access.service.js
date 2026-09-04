import { invalidRequest, permissionDenied } from "../../auth/errors.js";
import { requireWorkorderAccess } from "../../auth/resource-access.js";
import { getEffectiveWorkorderModulePolicy } from "../../db/repositories/workorder-policies.repo.js";
import { authorizeProductModule } from "../access/product-module-access.service.js";
import {
  getWorkorderModule,
  resolveEffectiveWorkorderModuleAccess,
  WORKORDER_ACCESS_MODES,
  WORKORDER_MODULES,
  WORKORDER_SURFACES,
} from "../../../../shared/workorder-modules.js";

const ACCESS_CAPABILITIES = Object.freeze({
  [WORKORDER_ACCESS_MODES.HIDDEN]: new Set(),
  [WORKORDER_ACCESS_MODES.READ]: new Set(["read"]),
  [WORKORDER_ACCESS_MODES.WRITE]: new Set(["read", "write"]),
  [WORKORDER_ACCESS_MODES.REQUIRED]: new Set(["read", "write"]),
});

export async function authorizeWorkorderModule(
  context,
  workorderId,
  {
    moduleKey,
    capability = "read",
    action = null,
    surface = WORKORDER_SURFACES.DETAIL,
    resourceAccess = {},
  },
  dependencies = {},
) {
  const result = await authorizeWorkorderModuleActions(
    context,
    workorderId,
    [{ moduleKey, capability, action, surface }],
    { resourceAccess },
    dependencies,
  );
  return result.authorizations[0];
}

function requireRegisteredAction({ moduleKey, capability, action, surface }) {
  const module = getWorkorderModule(moduleKey);
  const actionCapability = action === null
    ? null
    : module?.actionCapabilities?.[action] || "write";
  if (
    !module
    || !module.surfaces.includes(surface)
    || !module.capabilities.includes(capability)
    || (action !== null && !module.actions.includes(action))
    || (action !== null && capability !== actionCapability)
  ) {
    throw permissionDenied();
  }
  return module;
}

export async function authorizeWorkorderModuleActions(
  context,
  workorderId,
  requests,
  { resourceAccess = {} } = {},
  dependencies = {},
) {
  if (!Array.isArray(requests) || requests.length === 0) throw permissionDenied();
  const registered = requests.map((request) => ({
    ...request,
    capability: request.capability || "read",
    surface: request.surface || WORKORDER_SURFACES.DETAIL,
    module: requireRegisteredAction({
      ...request,
      capability: request.capability || "read",
      surface: request.surface || WORKORDER_SURFACES.DETAIL,
      role: context.actor.role,
    }),
  }));

  const requireAccess = dependencies.requireAccess || requireWorkorderAccess;
  const getEffectivePolicy = dependencies.getEffectivePolicy || getEffectiveWorkorderModulePolicy;
  const workorder = await requireAccess(context, workorderId, resourceAccess);
  const authorizeProduct = dependencies.authorizeProduct || authorizeProductModule;
  await authorizeProduct(context, {
    companyId: workorder.companyId,
    locationId: workorder.locationId || null,
    moduleKey: "workorders",
  }, registered.some((request) => request.capability === "write") ? "write" : "read");
  const policies = await getEffectivePolicy({
    companyId: workorder.companyId,
    locationId: workorder.locationId || null,
  });
  const authorizations = registered.map((request) => {
    const decision = resolveEffectiveWorkorderModuleAccess({
      role: context.actor.role,
      surface: request.surface,
      moduleKey: request.moduleKey,
      companyPolicy: policies?.companyPolicy,
      locationPolicy: policies?.locationPolicy,
      userId: context.actor.id,
    });
    if (!ACCESS_CAPABILITIES[decision.access]?.has(request.capability)) throw permissionDenied();
    return {
      ...decision,
      action: request.action || null,
      capability: request.capability,
      companyId: workorder.companyId,
      locationId: workorder.locationId || null,
      module: request.module,
      surface: request.surface,
      workorder,
      workorderId,
    };
  });
  return { authorizations, workorder };
}

export async function authorizeWorkorderCreate(
  context,
  { companyId, locationId, moduleKeys = ["concern"], enforceRequired = true },
  dependencies = {},
) {
  const authorizeProduct = dependencies.authorizeProduct || authorizeProductModule;
  await authorizeProduct(context, { companyId, locationId: locationId || null, moduleKey: "workorders" }, "write");
  const getEffectivePolicy = dependencies.getEffectivePolicy || getEffectiveWorkorderModulePolicy;
  const policies = await getEffectivePolicy({ companyId, locationId: locationId || null });
  const requested = new Set(moduleKeys);
  const decisions = WORKORDER_MODULES.filter((module) => module.surfaces.includes(WORKORDER_SURFACES.CREATE)).map((module) => {
    const moduleKey = module.key;
    const decision = resolveEffectiveWorkorderModuleAccess({
      role: context.actor.role,
      surface: WORKORDER_SURFACES.CREATE,
      moduleKey,
      companyPolicy: policies?.companyPolicy,
      locationPolicy: policies?.locationPolicy,
      userId: context.actor.id,
    });
    if (enforceRequired && decision.access === WORKORDER_ACCESS_MODES.REQUIRED && !requested.has(moduleKey)) {
      throw invalidRequest(`${module.label} is required to create this workorder.`);
    }
    if (!requested.has(moduleKey)) return { moduleKey, ...decision };
    requireRegisteredAction({
      moduleKey,
      capability: "write",
      action: null,
      surface: WORKORDER_SURFACES.CREATE,
      role: context.actor.role,
    });
    if (!ACCESS_CAPABILITIES[decision.access]?.has("write")) throw permissionDenied();
    return { moduleKey, ...decision };
  });
  return { decisions };
}

export async function resolveWorkorderModuleDecisions(
  context,
  workorderId,
  { surface = WORKORDER_SURFACES.DETAIL, resourceAccess = {} } = {},
  dependencies = {},
) {
  const requireAccess = dependencies.requireAccess || requireWorkorderAccess;
  const getEffectivePolicy = dependencies.getEffectivePolicy || getEffectiveWorkorderModulePolicy;
  const workorder = await requireAccess(context, workorderId, resourceAccess);
  const authorizeProduct = dependencies.authorizeProduct || authorizeProductModule;
  await authorizeProduct(context, {
    companyId: workorder.companyId,
    locationId: workorder.locationId || null,
    moduleKey: "workorders",
  }, "read");
  const policies = await getEffectivePolicy({
    companyId: workorder.companyId,
    locationId: workorder.locationId || null,
  });
  const decisions = Object.fromEntries(WORKORDER_MODULES
    .filter((module) => module.surfaces.includes(surface))
    .map((module) => [module.key, resolveEffectiveWorkorderModuleAccess({
      role: context.actor.role,
      surface,
      moduleKey: module.key,
      companyPolicy: policies?.companyPolicy,
      locationPolicy: policies?.locationPolicy,
      userId: context.actor.id,
    })]));
  return { workorder, decisions };
}

export function buildModuleAccessChangeEvent({
  actorId,
  companyId,
  locationId = null,
  targetType,
  targetId,
  moduleKey,
  surface,
  before,
  after,
  requestId = null,
  timestamp = new Date().toISOString(),
}) {
  return {
    type: "policy.module_access.changed",
    actorId,
    companyId,
    locationId,
    targetType,
    targetId,
    moduleKey,
    surface,
    before,
    after,
    requestId,
    timestamp,
  };
}
