import { fromNodeHeaders } from "better-auth/node";
import {
  acceptInvitation,
  addAdminLocation,
  adminLocationDetail,
  adminLocationWorkorderPolicy,
  adminLocations,
  adminOperations,
  adminOperationsSummary,
  changeAdminUserStatus,
  editAdminLocation,
  invitationDetail,
  inviteLocationUser,
  removeAdminUser,
  resendLocationInvitation,
  resetAdminUserPassword,
  saveAdminTemplate,
  saveAdminLocationWorkorderPolicy,
} from "../modules/admin/admin.service.js";
import { invitationPublicOrigin } from "../modules/admin/invitation-link.js";
import { parseWorkorderOperationsQuery } from "../modules/workorders/workorder-operations.schemas.js";
import {
  acceptInvitationSchema,
  createInvitationSchema,
  createLocationSchema,
  resetManagedUserPasswordSchema,
  updateManagedUserStatusSchema,
  updateLocationSchema,
  updateLocationTemplateSchema,
  updateLocationWorkorderPolicySchema,
} from "../modules/admin/admin.schemas.js";

function locationPath(pathname, suffix = "") {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^/api/admin/locations/([^/]+)${escaped}$`).exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function invitationToken(pathname, suffix = "") {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^/api/invitations/([^/]+)${escaped}$`).exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function managedUserPath(pathname, suffix = "") {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^/api/admin/locations/([^/]+)/users/([^/]+)${escaped}$`).exec(pathname);
  return match ? {
    locationId: decodeURIComponent(match[1]),
    userId: decodeURIComponent(match[2]),
  } : null;
}

function locationInvitationPath(pathname, suffix = "") {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^/api/admin/locations/([^/]+)/invitations/([^/]+)${escaped}$`).exec(pathname);
  return match ? {
    locationId: decodeURIComponent(match[1]),
    invitationId: decodeURIComponent(match[2]),
  } : null;
}

export async function handleAdminApi(req, res, url, helpers) {
  const { sendJson, readBody, requestContext } = helpers;

  const publicToken = invitationToken(url.pathname);
  if (req.method === "GET" && publicToken) {
    const invitation = await invitationDetail(publicToken);
    sendJson(
      res,
      invitation ? 200 : 404,
      invitation
        ? { invitation }
        : { error: "This invitation link has expired or was replaced. Ask an admin to resend it." },
    );
    return true;
  }
  const acceptToken = invitationToken(url.pathname, "/accept");
  if (req.method === "POST" && acceptToken) {
    const input = acceptInvitationSchema.parse(await readBody(req));
    sendJson(res, 200, { accepted: await acceptInvitation(acceptToken, input) });
    return true;
  }

  if (!url.pathname.startsWith("/api/admin/")) return false;
  const actor = requestContext.actor;

  if (req.method === "GET" && url.pathname === "/api/admin/operations/summary") {
    sendJson(res, 200, { counts: await adminOperationsSummary(requestContext, parseWorkorderOperationsQuery(url.searchParams)) });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/operations/workorders") {
    sendJson(res, 200, await adminOperations(requestContext, parseWorkorderOperationsQuery(url.searchParams)));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/locations") {
    sendJson(res, 200, { locations: await adminLocations(requestContext) });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/locations") {
    const input = createLocationSchema.parse(await readBody(req));
    sendJson(res, 201, { location: await addAdminLocation(input, actor, requestContext) });
    return true;
  }

  const detailId = locationPath(url.pathname);
  if (req.method === "GET" && detailId) {
    const detail = await adminLocationDetail(requestContext, detailId);
    sendJson(res, 200, detail);
    return true;
  }
  if (req.method === "PATCH" && detailId) {
    const input = updateLocationSchema.parse(await readBody(req));
    const location = await editAdminLocation(requestContext, detailId, input);
    sendJson(res, location ? 200 : 404, location ? { location } : { error: "Location not found." });
    return true;
  }

  const templateId = locationPath(url.pathname, "/template");
  if (req.method === "PUT" && templateId) {
    const input = updateLocationTemplateSchema.parse(await readBody(req));
    sendJson(res, 200, { template: await saveAdminTemplate(requestContext, templateId, input, actor.id) });
    return true;
  }

  const policyId = locationPath(url.pathname, "/workorder-policy");
  if (req.method === "GET" && policyId) {
    sendJson(res, 200, {
      policy: await adminLocationWorkorderPolicy(requestContext, policyId),
    });
    return true;
  }
  if (req.method === "PATCH" && policyId) {
    const input = updateLocationWorkorderPolicySchema.parse(await readBody(req));
    sendJson(res, 200, {
      policy: await saveAdminLocationWorkorderPolicy(
        requestContext,
        policyId,
        input,
        actor.id,
      ),
    });
    return true;
  }

  const invitationsId = locationPath(url.pathname, "/invitations");
  if (req.method === "POST" && invitationsId) {
    const location = await adminLocationDetail(requestContext, invitationsId);
    const input = createInvitationSchema.parse(await readBody(req));
    const origin = invitationPublicOrigin(req);
    res.setHeader("cache-control", "no-store");
    sendJson(res, 201, await inviteLocationUser(location.location, input, actor.id, origin));
    return true;
  }

  const resendInvitation = locationInvitationPath(url.pathname, "/resend");
  if (req.method === "POST" && resendInvitation) {
    res.setHeader("cache-control", "no-store");
    sendJson(res, 200, await resendLocationInvitation(
      requestContext,
      resendInvitation.locationId,
      resendInvitation.invitationId,
      actor.id,
      invitationPublicOrigin(req),
    ));
    return true;
  }

  const userStatus = managedUserPath(url.pathname, "/status");
  if (req.method === "PATCH" && userStatus) {
    const input = updateManagedUserStatusSchema.parse(await readBody(req));
    sendJson(res, 200, {
      user: await changeAdminUserStatus(
        requestContext,
        actor,
        userStatus.locationId,
        userStatus.userId,
        input,
        fromNodeHeaders(req.headers),
      ),
    });
    return true;
  }

  const userPassword = managedUserPath(url.pathname, "/password");
  if (req.method === "POST" && userPassword) {
    const input = resetManagedUserPasswordSchema.parse(await readBody(req));
    sendJson(res, 200, {
      result: await resetAdminUserPassword(
        requestContext,
        actor,
        userPassword.locationId,
        userPassword.userId,
        input,
        fromNodeHeaders(req.headers),
      ),
    });
    return true;
  }

  const managedUser = managedUserPath(url.pathname);
  if (req.method === "DELETE" && managedUser) {
    sendJson(res, 200, {
      result: await removeAdminUser(
        requestContext,
        actor,
        managedUser.locationId,
        managedUser.userId,
      ),
    });
    return true;
  }

  return false;
}
