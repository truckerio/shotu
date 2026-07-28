import { createHash, randomBytes, randomUUID } from "node:crypto";
import { auth } from "../../auth/auth.js";
import {
  acceptUserInvitation,
  createUserInvitations,
  getInvitationByTokenHash,
  getPendingInvitationByLocationEmail,
  listInvitationsByLocation,
  rotateUserInvitation,
} from "../../db/repositories/invitations.repo.js";
import {
  createLocationWithTemplate,
  getLocationById,
  listLocationsWithAdminCounts,
  updateLocation,
} from "../../db/repositories/locations.repo.js";
import { getLocationTemplate, upsertLocationTemplate } from "../../db/repositories/templates.repo.js";
import {
  getLocationWorkorderPolicy,
  saveLocationWorkorderPolicy,
} from "../../db/repositories/workorder-policies.repo.js";
import { findAuthUserByEmail, getAuthActorByAuthUserId } from "../../db/repositories/auth-users.repo.js";
import {
  deleteManagedUser,
  getManagedUserByCompanies,
  getManagedUser,
  listUsersByLocation,
  recordAdminUserEvent,
  replaceManagedUserLocations,
  setManagedUserActive,
} from "../../db/repositories/users.repo.js";
import { queryAuthorizedWorkorders, summarizeAuthorizedWorkorders } from "../workorders/workorder-operations.service.js";
import { requireCompanyAccess } from "../../auth/authorize.js";
import { invalidRequest, resourceNotFound } from "../../auth/errors.js";
import { buildInvitationUrl } from "./invitation-link.js";

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function invitationView(invitation) {
  if (!invitation) return null;
  return {
    id: invitation.id,
    email: invitation.email,
    name: invitation.name,
    role: invitation.role,
    status: invitation.status,
    locationId: invitation.location_id,
    locationName: invitation.location_name,
    expiresAt: invitation.expires_at,
    acceptedAt: invitation.accepted_at,
    createdAt: invitation.created_at,
    expired: invitation.status === "pending" && new Date(invitation.expires_at) <= new Date(),
  };
}

function authorizedCompanyIds(context) {
  const companyIds = [...(context.companyIds || [])];
  if (!companyIds.length) throw resourceNotFound("Company");
  return companyIds;
}

async function authorizedLocation(context, locationId) {
  const location = await getLocationById(locationId, authorizedCompanyIds(context));
  if (!location) throw resourceNotFound("Location");
  requireCompanyAccess(context, location.company_id);
  return location;
}

function managedCompanyIds(target) {
  return (target.company_ids || []).map(String);
}

async function authorizedManagedUser(context, locationId, userId) {
  const location = await authorizedLocation(context, locationId);
  const target = await getManagedUser(locationId, userId, authorizedCompanyIds(context));
  if (!target) throw resourceNotFound("User");
  for (const companyId of managedCompanyIds(target)) {
    requireCompanyAccess(context, companyId);
  }
  return { location, target };
}

function requireLogin(target) {
  if (!target.auth_user_id) {
    throw invalidRequest("This user does not have a login account.");
  }
}

export async function adminLocations(context) {
  return listLocationsWithAdminCounts(authorizedCompanyIds(context));
}

export async function adminOperations(context, input) {
  return queryAuthorizedWorkorders(context, input);
}

export async function adminOperationsSummary(context, input) {
  return summarizeAuthorizedWorkorders(context, input);
}

export async function addAdminLocation(input, actor, context) {
  const companyIds = authorizedCompanyIds(context);
  const companyId = input.companyId || companyIds[0];
  requireCompanyAccess(context, companyId);
  return createLocationWithTemplate({
    ...input,
    companyId,
    actorId: actor.id,
  });
}

export async function editAdminLocation(context, locationId, input) {
  await authorizedLocation(context, locationId);
  return updateLocation(locationId, input);
}

export async function adminLocationDetail(context, locationId) {
  const location = await authorizedLocation(context, locationId);
  const [users, invitations, template, policy] = await Promise.all([
    listUsersByLocation(locationId),
    listInvitationsByLocation(locationId),
    getLocationTemplate(locationId),
    getLocationWorkorderPolicy(locationId, authorizedCompanyIds(context)),
  ]);
  return { location, users, invitations: invitations.map(invitationView), template, policy };
}

export async function changeAdminUserStatus(context, actor, locationId, userId, input, headers) {
  if (actor.id === userId) {
    throw invalidRequest("You cannot deactivate or reactivate your own account.");
  }
  const { location, target } = await authorizedManagedUser(context, locationId, userId);
  requireLogin(target);

  if (input.active) {
    await auth.api.unbanUser({ body: { userId: target.auth_user_id }, headers });
    try {
      return await setManagedUserActive({
        userId,
        companyId: location.company_id,
        locationId,
        active: true,
        actorId: actor.id,
      });
    } catch (error) {
      await auth.api.banUser({
        body: { userId: target.auth_user_id, banReason: "Account activation failed." },
        headers,
      }).catch(() => {});
      throw error;
    }
  }

  await auth.api.banUser({
    body: { userId: target.auth_user_id, banReason: "Deactivated by an administrator." },
    headers,
  });
  try {
    return await setManagedUserActive({
      userId,
      companyId: location.company_id,
      locationId,
      active: false,
      actorId: actor.id,
    });
  } catch (error) {
    await auth.api.unbanUser({ body: { userId: target.auth_user_id }, headers }).catch(() => {});
    throw error;
  }
}

export async function resetAdminUserPassword(context, actor, locationId, userId, input, headers) {
  if (actor.id === userId) {
    throw invalidRequest("You cannot reset your own password from user management.");
  }
  const { target } = await authorizedManagedUser(context, locationId, userId);
  requireLogin(target);
  await auth.api.setUserPassword({
    body: { userId: target.auth_user_id, newPassword: input.password },
    headers,
  });
  await auth.api.revokeUserSessions({
    body: { userId: target.auth_user_id },
    headers,
  });
  for (const companyId of managedCompanyIds(target)) {
    await recordAdminUserEvent({
      companyId,
      actorId: actor.id,
      targetUserId: userId,
      action: "password_reset",
      details: { sessionsRevoked: true },
    });
  }
  return { reset: true };
}

export async function removeAdminUser(context, actor, locationId, userId) {
  if (actor.id === userId) {
    throw invalidRequest("You cannot delete your own account.");
  }
  const { target } = await authorizedManagedUser(context, locationId, userId);
  return deleteManagedUser({
    userId,
    companyIds: managedCompanyIds(target),
    actorId: actor.id,
  });
}

export async function saveAdminTemplate(context, locationId, input, actorId) {
  await authorizedLocation(context, locationId);
  return upsertLocationTemplate(locationId, input, actorId);
}

export async function adminLocationWorkorderPolicy(context, locationId) {
  await authorizedLocation(context, locationId);
  return getLocationWorkorderPolicy(locationId, authorizedCompanyIds(context));
}

export async function saveAdminLocationWorkorderPolicy(context, locationId, input, actorId) {
  const location = await authorizedLocation(context, locationId);
  return saveLocationWorkorderPolicy({
    locationId,
    companyId: location.company_id,
    mechanicCanRecordParts: input.mechanicCanRecordParts,
    actorId,
  });
}

export async function updateAdminUserLocations(context, actor, userId, input) {
  if (actor.id === userId) throw invalidRequest("You cannot change your own location access.");
  const targets = await getManagedUserByCompanies(userId, authorizedCompanyIds(context));
  if (!targets.length) throw resourceNotFound("User");
  const target = input.companyId
    ? targets.find(({ company_id: companyId }) => companyId === input.companyId)
    : targets.length === 1 ? targets[0] : null;
  if (!target) throw invalidRequest("Select an authorized company for this user.");
  requireCompanyAccess(context, target.company_id);
  if (target.role === "admin") {
    throw invalidRequest("Admins automatically have access to every company location.");
  }
  try {
    return await replaceManagedUserLocations({
      userId,
      companyId: target.company_id,
      locationIds: input.locationIds,
      actorId: actor.id,
    });
  } catch (error) {
    if (error?.message === "One or more locations are invalid.") throw invalidRequest(error.message);
    throw error;
  }
}

export async function inviteLocationUser(context, location, input, actorId, origin) {
  const locationIds = [...new Set([location.id, ...(input.locationIds || [])])];
  const locations = await Promise.all(locationIds.map((locationId) => authorizedLocation(context, locationId)));
  if (locations.some((candidate) => candidate.company_id !== location.company_id)) {
    throw invalidRequest("Every invitation location must belong to the same company.");
  }
  const pending = await Promise.all(
    locationIds.map((locationId) => getPendingInvitationByLocationEmail(locationId, input.email)),
  );
  if (pending.some((existing) => existing && new Date(existing.expires_at) > new Date())) {
    throw invalidRequest("A pending invitation already exists for this email. Use Resend link.");
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const batchId = randomUUID();
  const invitations = locationIds.map((locationId) => {
    const token = randomBytes(32).toString("base64url");
    return {
      input: {
        name: input.name,
        email: input.email,
        role: input.role,
        companyId: location.company_id,
        locationId,
        actorId,
        tokenHash: tokenHash(token),
        expiresAt,
        batchId,
      },
      token,
    };
  });
  let created;
  try {
    created = await createUserInvitations(invitations.map(({ input: invitation }) => invitation));
  } catch (error) {
    if (error?.code === "23505") {
      throw invalidRequest("A pending invitation already exists for this email. Use Resend link.");
    }
    throw error;
  }
  const primaryIndex = locationIds.indexOf(location.id);
  return {
    invitation: invitationView(created[primaryIndex]),
    invitations: created.map(invitationView),
    inviteUrl: buildInvitationUrl(origin, invitations[primaryIndex].token),
  };
}

export async function resendLocationInvitation(context, locationId, invitationId, actorId, origin) {
  await authorizedLocation(context, locationId);
  const token = randomBytes(32).toString("base64url");
  const invitation = await rotateUserInvitation({
    invitationId,
    locationId,
    actorId,
    tokenHash: tokenHash(token),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  if (!invitation) throw resourceNotFound("Pending invitation");
  return {
    invitation: invitationView(invitation),
    inviteUrl: buildInvitationUrl(origin, token),
  };
}

export async function invitationDetail(token) {
  const invitation = await getInvitationByTokenHash(tokenHash(token));
  if (!invitation || invitation.status !== "pending" || new Date(invitation.expires_at) <= new Date()) return null;
  return invitationView(invitation);
}

export async function acceptInvitation(token, input) {
  const invitation = await getInvitationByTokenHash(tokenHash(token));
  if (!invitation || invitation.status !== "pending" || new Date(invitation.expires_at) <= new Date()) {
    throw invalidRequest("This invitation link has expired or was replaced. Ask an admin to resend it.");
  }

  let authUser = await findAuthUserByEmail(invitation.email);
  if (authUser?.id) {
    const linkedActor = await getAuthActorByAuthUserId(authUser.id);
    if (linkedActor) {
      throw new Error("An account already exists for this email. Ask an admin to assign its location.");
    }
  } else {
    try {
      await createInvitationAuthUser({ invitation, input });
    } catch (error) {
      throw invalidRequest(error?.message || "Unable to create login for this invitation.");
    }
    authUser = await findAuthUserByEmail(invitation.email);
  }
  if (!authUser?.id) throw new Error("Unable to create login for this invitation.");
  return acceptUserInvitation({ invitationId: invitation.id, authUserId: authUser.id, username: authUser.username || input.username });
}

export async function createInvitationAuthUser({ invitation, input, authApi = auth.api }) {
  await authApi.createUser({
    body: {
      name: invitation.name,
      email: invitation.email,
      password: input.password,
      role: "user",
      data: {
        username: input.username,
        displayUsername: input.username,
      },
    },
  });
}
