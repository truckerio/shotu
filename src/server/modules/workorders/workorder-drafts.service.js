import { AuthError, invalidRequest, permissionDenied, resourceNotFound } from "../../auth/errors.js";
import { getLocationById } from "../../db/repositories/locations.repo.js";
import { WorkorderLifecycleConflictError } from "../../db/repositories/operational-workorders.repo.js";
import {
  WorkorderDraftConflictError,
  WorkorderDraftLimitError,
  WorkorderDraftPermissionError,
  createWorkorderDraft,
  discardWorkorderDraft,
  getWorkorderDraftById,
  getWorkorderDraftOwnership,
  listActiveWorkorderDrafts,
  submitWorkorderDraft,
  takeoverWorkorderDraft,
  updateWorkorderDraft,
} from "../../db/repositories/workorder-drafts.repo.js";
import { CustomerDirectoryIdentityError } from "../../db/repositories/customer-directory.repo.js";
import { createWorkorderSchema } from "./workorder.schemas.js";
import { authorizeWorkorderCreate } from "./workorder-module-access.service.js";
import { workorderInputModules } from "./workorder-module-projection.js";
import { trustedLocalLaborProduct } from "../labor/labor-products.service.js";
import { createHash } from "node:crypto";
import { issueInformationalDraftEstimate } from "../customer-documents/customer-documents.service.js";
import { bindInformationalEstimateToWorkorder } from "../../db/repositories/customer-documents.repo.js";
import { companyRoleScope, effectiveCompanyContext, effectiveCompanyRole, requireCompanyRole } from "../../auth/company-role.js";

function draftScope(context) {
  const actor = context?.actor;
  const scope = companyRoleScope(context, ["office", "admin"]);
  if (!actor || !scope.companyIds.length) throw permissionDenied();
  return {
    actor,
    ...scope,
  };
}

async function accessibleLocation(context, locationId, dependencies = {}) {
  const { companyIds } = draftScope(context);
  const loadLocation = dependencies.getLocation || getLocationById;
  const location = await loadLocation(locationId, companyIds);
  if (!location) throw resourceNotFound("Location");
  if (!["office", "admin"].includes(effectiveCompanyRole(context, location.company_id))) throw resourceNotFound("Location");
  if (effectiveCompanyRole(context, location.company_id) !== "admin" && !context.locationIds?.has(locationId)) {
    throw resourceNotFound("Location");
  }
  return location;
}

function mapDraftError(error) {
  if (error instanceof CustomerDirectoryIdentityError) {
    throw new AuthError(error.statusCode, error.code, error.message);
  }
  if (error instanceof WorkorderLifecycleConflictError) {
    throw new AuthError(error.statusCode, error.code, error.message);
  }
  if (!(error instanceof WorkorderDraftConflictError)
    && !(error instanceof WorkorderDraftLimitError)
    && !(error instanceof WorkorderDraftPermissionError)) throw error;
  throw new AuthError(error.statusCode, error.code, error.message);
}

function finalCreateInput(draft) {
  const result = createWorkorderSchema.safeParse({
    ...draft.payload,
    companyId: draft.companyId,
    locationId: draft.locationId,
    createdByUserId: undefined,
  });
  if (!result.success) {
    const issue = result.error.issues[0];
    const message = issue?.path?.[0] === "concern"
      ? "Concern is required."
      : issue?.message || "Complete the required workorder fields.";
    throw invalidRequest(message);
  }
  return {
    ...result.data,
    companyId: draft.companyId,
    locationId: draft.locationId,
    createdByUserId: draft.createdByUserId,
  };
}

export async function prepareUserWorkorderDraftSubmission(context, draft, pricingOverride, dependencies = {}) {
  draftScope(context);
  context = effectiveCompanyContext(context, draft.companyId);
  const { actor } = context;
  requireCompanyRole(context, draft.companyId, ["office", "admin"]);
  if (!draft.locationId) throw invalidRequest("Location is required before creating the workorder.");
  await accessibleLocation(context, draft.locationId, dependencies);
  const pricing = pricingOverride || draft.payload?.pricing;
  if (pricing && !["office", "admin"].includes(actor.role)) throw permissionDenied();
  if (pricing && !pricing.expectedFingerprint) {
    throw new AuthError(409, "WORKORDER_PRICING_PREVIEW_REQUIRED", "Refresh the pricing preview before creating this workorder.");
  }
  const prepared = {
    ...finalCreateInput({ ...draft, payload: { ...draft.payload, ...(pricing ? { pricing } : {}) } }),
    createdByRole: actor.role,
    pricingActorId: actor.id,
    authorizationClassification: draft.authorizationClassification,
    authorizationExceptionReason: draft.authorizationExceptionReason,
  };
  if (pricing) {
    await (dependencies.authorizeCreate || authorizeWorkorderCreate)(context, {
      companyId: prepared.companyId, locationId: prepared.locationId,
      moduleKeys: workorderInputModules(prepared, { create: true }),
    });
    if (prepared.formData?.laborProduct?.productId) {
      prepared.formData.laborProduct = await (dependencies.resolveLaborProduct || trustedLocalLaborProduct)({
        companyId: prepared.companyId, locationId: prepared.locationId,
        productId: prepared.formData.laborProduct.productId,
      }, context);
    }
  }
  return prepared;
}

export async function listUserWorkorderDrafts(context, { type = "workorder" }, dependencies = {}) {
  const { actor, companyIds, adminCompanyIds, locationIds } = draftScope(context);
  const listDrafts = dependencies.listDrafts || listActiveWorkorderDrafts;
  return listDrafts({
    companyIds,
    locationIds,
    adminCompanyIds,
    userId: actor.id,
    role: actor.role,
    type,
  });
}

export async function createUserWorkorderDraft(context, input, dependencies = {}) {
  const { actor, companyIds } = draftScope(context);
  const location = input.locationId
    ? await accessibleLocation(context, input.locationId, dependencies)
    : null;
  if (!location && companyIds.length !== 1) {
    throw invalidRequest("Select a location before starting a draft for one of multiple companies.");
  }
  const targetCompanyId = location?.company_id || companyIds[0];
  if (["internal_fleet", "exempt"].includes(input.authorizationClassification)
    && effectiveCompanyRole(context, targetCompanyId) !== "admin") throw permissionDenied();
  const createDraft = dependencies.createDraft || createWorkorderDraft;
  try {
    return await createDraft({
      companyId: targetCompanyId,
      locationId: location?.id || null,
      userId: actor.id,
      type: input.type,
      payload: input.payload,
      authorizationClassification: input.authorizationClassification || "approval_not_required",
      authorizationExceptionReason: input.authorizationExceptionReason || null,
    });
  } catch (error) {
    mapDraftError(error);
  }
}

export async function getUserWorkorderDraft(context, id, dependencies = {}) {
  const { actor, companyIds, adminCompanyIds, locationIds } = draftScope(context);
  const getDraft = dependencies.getDraft || getWorkorderDraftById;
  const draft = await getDraft({
    id,
    companyIds,
    locationIds,
    adminCompanyIds,
    userId: actor.id,
    role: actor.role,
  });
  if (!draft) throw resourceNotFound("Draft");
  return draft;
}

export async function updateUserWorkorderDraft(context, id, input, dependencies = {}) {
  const { actor, companyIds, adminCompanyIds, locationIds } = draftScope(context);
  const getOwnership = dependencies.getOwnership || getWorkorderDraftOwnership;
  const ownership = await getOwnership({
    id,
    companyIds,
    locationIds,
    adminCompanyIds,
    userId: actor.id,
    role: actor.role,
  });
  if (!ownership) throw resourceNotFound("Draft");
  if (["internal_fleet", "exempt"].includes(input.authorizationClassification)
    && effectiveCompanyRole(context, ownership.companyId) !== "admin") {
    throw permissionDenied();
  }

  if (input.locationId) {
    const location = await accessibleLocation(context, input.locationId, dependencies);
    if (location.company_id !== ownership.companyId) {
      throw invalidRequest("A draft cannot move to another company.");
    }
  }

  const updateDraft = dependencies.updateDraft || updateWorkorderDraft;
  try {
    const draft = await updateDraft({
      id,
      companyIds,
      locationIds,
      adminCompanyIds,
      userId: actor.id,
      ...input,
    });
    if (!draft) throw resourceNotFound("Draft");
    return draft;
  } catch (error) {
    mapDraftError(error);
  }
}

export async function discardUserWorkorderDraft(context, id, dependencies = {}) {
  const { actor, companyIds, adminCompanyIds, locationIds } = draftScope(context);
  const discardDraft = dependencies.discardDraft || discardWorkorderDraft;
  try {
    const discarded = await discardDraft({
      id,
      companyIds,
      locationIds,
      adminCompanyIds,
      userId: actor.id,
      role: actor.role,
    });
    if (!discarded) throw resourceNotFound("Draft");
    return true;
  } catch (error) {
    mapDraftError(error);
  }
}

export async function submitUserWorkorderDraft(context, id, input, dependencies = {}) {
  const { actor, companyIds, adminCompanyIds, locationIds } = draftScope(context);
  const submitDraft = dependencies.submitDraft || submitWorkorderDraft;
  try {
    const result = await submitDraft({
      id,
      companyIds,
      locationIds,
      adminCompanyIds,
      userId: actor.id,
      version: input.version,
      activationPolicy: null,
      issueInformationalEstimate: ({ draft, preparedInput, client }) => (
        dependencies.issueInformationalEstimate || issueInformationalDraftEstimate
      )(context, draft, preparedInput, client, dependencies),
      bindInformationalEstimate: async ({ estimate, workorderId, client }) => {
        const command = {
          companyId: estimate.revision.companyId, locationId: estimate.revision.locationId,
          documentId: estimate.revision.documentId, revisionId: estimate.revision.id,
          draftId: id, workorderId, actorId: actor.id,
          idempotencyKey: `informational-bind:${id}`,
        };
        const requestHash = createHash("sha256").update(JSON.stringify(command)).digest("hex");
        return (dependencies.bindInformationalEstimate || bindInformationalEstimateToWorkorder)(
          { ...command, requestHash }, { client },
        );
      },
      prepareCreateInput: (draft) => prepareUserWorkorderDraftSubmission(
        context, draft, input.pricing || draft.payload?.pricing, dependencies,
      ),
    });
    if (!result) throw resourceNotFound("Draft");
    return result;
  } catch (error) {
    mapDraftError(error);
  }
}

export async function takeoverUserWorkorderDraft(context, id, input, dependencies = {}) {
  const { actor, adminCompanyIds } = draftScope(context);
  if (!adminCompanyIds.length) throw permissionDenied();
  const takeover = dependencies.takeover || takeoverWorkorderDraft;
  try {
    const draft = await takeover({
      id,
      companyIds: adminCompanyIds,
      adminCompanyIds,
      locationIds: [],
      userId: actor.id,
      role: "admin",
      version: input.version,
    });
    if (!draft) throw resourceNotFound("Draft");
    return draft;
  } catch (error) {
    mapDraftError(error);
  }
}
