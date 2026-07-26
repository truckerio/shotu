import { AuthError, invalidRequest, permissionDenied, resourceNotFound } from "../../auth/errors.js";
import { getLocationById } from "../../db/repositories/locations.repo.js";
import {
  WorkorderDraftConflictError,
  createWorkorderDraft,
  discardWorkorderDraft,
  getWorkorderDraftById,
  getWorkorderDraftOwnership,
  listActiveWorkorderDrafts,
  submitWorkorderDraft,
  updateWorkorderDraft,
} from "../../db/repositories/workorder-drafts.repo.js";
import { createWorkorderSchema } from "./workorder.schemas.js";

function draftScope(context) {
  const actor = context?.actor;
  if (!actor || !["office", "admin"].includes(actor.role)) throw permissionDenied();
  return {
    actor,
    companyIds: [...(context.companyIds || [])],
  };
}

async function accessibleLocation(context, locationId, dependencies = {}) {
  const { actor, companyIds } = draftScope(context);
  const loadLocation = dependencies.getLocation || getLocationById;
  const location = await loadLocation(locationId, companyIds);
  if (!location) throw resourceNotFound("Location");
  if (actor.role !== "admin" && !context.locationIds?.has(locationId)) {
    throw resourceNotFound("Location");
  }
  return location;
}

function mapDraftError(error) {
  if (!(error instanceof WorkorderDraftConflictError)) throw error;
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

export async function listUserWorkorderDrafts(context, { type = "workorder" }, dependencies = {}) {
  const { actor, companyIds } = draftScope(context);
  const listDrafts = dependencies.listDrafts || listActiveWorkorderDrafts;
  return listDrafts({ companyIds, userId: actor.id, type });
}

export async function createUserWorkorderDraft(context, input, dependencies = {}) {
  const { actor, companyIds } = draftScope(context);
  const location = input.locationId
    ? await accessibleLocation(context, input.locationId, dependencies)
    : null;
  if (!location && companyIds.length !== 1) {
    throw invalidRequest("Select a location before starting a draft for one of multiple companies.");
  }
  const createDraft = dependencies.createDraft || createWorkorderDraft;
  return createDraft({
    companyId: location?.company_id || companyIds[0],
    locationId: location?.id || null,
    userId: actor.id,
    type: input.type,
    payload: input.payload,
  });
}

export async function getUserWorkorderDraft(context, id, dependencies = {}) {
  const { actor, companyIds } = draftScope(context);
  const getDraft = dependencies.getDraft || getWorkorderDraftById;
  const draft = await getDraft({ id, companyIds, userId: actor.id });
  if (!draft) throw resourceNotFound("Draft");
  return draft;
}

export async function updateUserWorkorderDraft(context, id, input, dependencies = {}) {
  const { actor, companyIds } = draftScope(context);
  const getOwnership = dependencies.getOwnership || getWorkorderDraftOwnership;
  const ownership = await getOwnership({ id, companyIds, userId: actor.id });
  if (!ownership) throw resourceNotFound("Draft");

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
  const { actor, companyIds } = draftScope(context);
  const discardDraft = dependencies.discardDraft || discardWorkorderDraft;
  try {
    const discarded = await discardDraft({ id, companyIds, userId: actor.id });
    if (!discarded) throw resourceNotFound("Draft");
    return true;
  } catch (error) {
    mapDraftError(error);
  }
}

export async function submitUserWorkorderDraft(context, id, input, dependencies = {}) {
  const { actor, companyIds } = draftScope(context);
  const submitDraft = dependencies.submitDraft || submitWorkorderDraft;
  try {
    const result = await submitDraft({
      id,
      companyIds,
      userId: actor.id,
      version: input.version,
      prepareCreateInput: async (draft) => {
        if (!draft.locationId) throw invalidRequest("Location is required before creating the workorder.");
        await accessibleLocation(context, draft.locationId, dependencies);
        return finalCreateInput(draft);
      },
    });
    if (!result) throw resourceNotFound("Draft");
    return result;
  } catch (error) {
    mapDraftError(error);
  }
}
