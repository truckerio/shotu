import {
  acceptInvitation,
  addAdminLocation,
  adminLocationDetail,
  adminLocations,
  adminOperations,
  adminOperationsSummary,
  editAdminLocation,
  invitationDetail,
  inviteLocationUser,
  saveAdminTemplate,
} from "../modules/admin/admin.service.js";
import { parseWorkorderOperationsQuery } from "../modules/workorders/workorder-operations.schemas.js";
import {
  acceptInvitationSchema,
  createInvitationSchema,
  createLocationSchema,
  updateLocationSchema,
  updateLocationTemplateSchema,
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

export async function handleAdminApi(req, res, url, helpers) {
  const { sendJson, readBody, requestContext } = helpers;

  const publicToken = invitationToken(url.pathname);
  if (req.method === "GET" && publicToken) {
    const invitation = await invitationDetail(publicToken);
    sendJson(res, invitation ? 200 : 404, invitation ? { invitation } : { error: "Invitation is no longer available." });
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
    sendJson(res, 200, { locations: await adminLocations() });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/locations") {
    const input = createLocationSchema.parse(await readBody(req));
    sendJson(res, 201, { location: await addAdminLocation(input, actor) });
    return true;
  }

  const detailId = locationPath(url.pathname);
  if (req.method === "GET" && detailId) {
    const detail = await adminLocationDetail(detailId);
    sendJson(res, detail ? 200 : 404, detail || { error: "Location not found." });
    return true;
  }
  if (req.method === "PATCH" && detailId) {
    const input = updateLocationSchema.parse(await readBody(req));
    const location = await editAdminLocation(detailId, input);
    sendJson(res, location ? 200 : 404, location ? { location } : { error: "Location not found." });
    return true;
  }

  const templateId = locationPath(url.pathname, "/template");
  if (req.method === "PUT" && templateId) {
    const input = updateLocationTemplateSchema.parse(await readBody(req));
    sendJson(res, 200, { template: await saveAdminTemplate(templateId, input, actor.id) });
    return true;
  }

  const invitationsId = locationPath(url.pathname, "/invitations");
  if (req.method === "POST" && invitationsId) {
    const location = await adminLocationDetail(invitationsId);
    if (!location) {
      sendJson(res, 404, { error: "Location not found." });
      return true;
    }
    const input = createInvitationSchema.parse(await readBody(req));
    const origin = `${url.protocol}//${req.headers.host}`;
    sendJson(res, 201, await inviteLocationUser(location.location, input, actor.id, origin));
    return true;
  }

  return false;
}
