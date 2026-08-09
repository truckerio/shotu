import { fromNodeHeaders } from "better-auth/node";
import {
  acceptInvitation,
  addAdminLocation,
  adminLocationDetail,
  adminLocationWorkorderPolicy,
  adminCompanyWorkorderModulePolicy,
  adminKioskDevices,
  adminLocations,
  adminOperations,
  adminOperationsSummary,
  changeAdminUserStatus,
  editAdminLocation,
  invitationDetail,
  inviteLocationUser,
  removeAdminUser,
  resendLocationInvitation,
  requestAdminUserPasswordReset,
  resetAdminUserPassword,
  registerAdminKioskDevice,
  revokeAdminKioskDevice,
  requestAdminUserPasswordResetForLocation,
  setAdminMechanicKioskPin,
  updateAdminUserLocations,
  saveAdminTemplate,
  saveAdminLocationWorkorderPolicy,
  saveAdminCompanyWorkorderModulePolicy,
  adminWorkorderModuleCatalog,
} from "../modules/admin/admin.service.js";
import { invitationPublicOrigin } from "../modules/admin/invitation-link.js";
import { parseWorkorderOperationsQuery } from "../modules/workorders/workorder-operations.schemas.js";
import {
  acceptInvitationSchema,
  createInvitationSchema,
  createLocationSchema,
  requestManagedUserPasswordResetSchema,
  resetManagedUserPasswordSchema,
  issueKioskPinSchema,
  registerKioskDeviceSchema,
  updateManagedUserStatusSchema,
  updateManagedUserLocationsSchema,
  updateLocationSchema,
  updateLocationTemplateSchema,
  updateLocationWorkorderPolicySchema,
  updateCompanyWorkorderModulePolicySchema,
} from "../modules/admin/admin.schemas.js";
import { kioskDeviceCookie } from "../modules/kiosk/kiosk-cookie.js";
import {
  patchCanonicalModuleAccess,
  readCanonicalModuleAccess,
  readCanonicalUserModuleAccess,
} from "../modules/admin/module-access.service.js";
import {
  canonicalModuleRulePatchSchema,
  moduleAccessRoleSchema,
  moduleAccessScopeSchema,
} from "../modules/admin/module-access.schemas.js";

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

function companyManagedUserPath(pathname, suffix = "") {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^/api/admin/users/([^/]+)${escaped}$`).exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function companyPath(pathname, suffix = "") {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^/api/admin/companies/([^/]+)${escaped}$`).exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function locationInvitationPath(pathname, suffix = "") {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^/api/admin/locations/([^/]+)/invitations/([^/]+)${escaped}$`).exec(pathname);
  return match ? {
    locationId: decodeURIComponent(match[1]),
    invitationId: decodeURIComponent(match[2]),
  } : null;
}

function locationKioskDevicePath(pathname, suffix = "") {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^/api/admin/locations/([^/]+)/kiosk-devices/([^/]+)${escaped}$`).exec(pathname);
  return match ? {
    locationId: decodeURIComponent(match[1]),
    deviceId: decodeURIComponent(match[2]),
  } : null;
}

export async function handleAdminApi(req, res, url, helpers, dependencies = {}) {
  const { sendJson, readBody, requestContext, emitAdministrativeAuditEvent } = helpers;

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
  const readModuleAccess = dependencies.readModuleAccess || readCanonicalModuleAccess;
  const readUserModuleAccess = dependencies.readUserModuleAccess || readCanonicalUserModuleAccess;
  const patchModuleAccess = dependencies.patchModuleAccess || patchCanonicalModuleAccess;

  if (url.pathname === "/api/admin/module-access" && req.method === "GET") {
    const scope = moduleAccessScopeSchema.parse({
      companyId: url.searchParams.get("companyId"),
      locationId: url.searchParams.get("locationId") || undefined,
    });
    sendJson(res, 200, { policy: await readModuleAccess(requestContext, scope) });
    return true;
  }
  const canonicalUserMatch = /^\/api\/admin\/module-access\/users\/([^/]+)$/.exec(url.pathname);
  if (canonicalUserMatch && req.method === "GET") {
    const userId = moduleAccessScopeSchema.shape.companyId.parse(decodeURIComponent(canonicalUserMatch[1]));
    const scope = moduleAccessScopeSchema.parse({
      companyId: url.searchParams.get("companyId"),
      locationId: url.searchParams.get("locationId") || undefined,
    });
    sendJson(res, 200, { policy: await readUserModuleAccess(requestContext, userId, scope) });
    return true;
  }
  if (canonicalUserMatch && req.method === "PATCH") {
    const userId = moduleAccessScopeSchema.shape.companyId.parse(decodeURIComponent(canonicalUserMatch[1]));
    const input = canonicalModuleRulePatchSchema.parse(await readBody(req));
    sendJson(res, 200, { policy: await patchModuleAccess(requestContext, "user", userId, input, {
      emitAuditEvent: emitAdministrativeAuditEvent,
      requestId: req.requestId || null,
    }) });
    return true;
  }
  const canonicalRoleMatch = /^\/api\/admin\/module-access\/roles\/([^/]+)$/.exec(url.pathname);
  if (canonicalRoleMatch && req.method === "PATCH") {
    const role = moduleAccessRoleSchema.parse(decodeURIComponent(canonicalRoleMatch[1]));
    const input = canonicalModuleRulePatchSchema.parse(await readBody(req));
    sendJson(res, 200, { policy: await patchModuleAccess(requestContext, "role", role, input, {
      emitAuditEvent: emitAdministrativeAuditEvent,
      requestId: req.requestId || null,
    }) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/module-catalog") {
    sendJson(res, 200, { catalog: adminWorkorderModuleCatalog() });
    return true;
  }

  const companyModulePolicyId = companyPath(url.pathname, "/module-policy");
  if (req.method === "GET" && companyModulePolicyId) {
    sendJson(res, 200, {
      policy: await adminCompanyWorkorderModulePolicy(requestContext, companyModulePolicyId),
    });
    return true;
  }
  if (req.method === "PATCH" && companyModulePolicyId) {
    const input = updateCompanyWorkorderModulePolicySchema.parse(await readBody(req));
    sendJson(res, 200, {
      policy: await saveAdminCompanyWorkorderModulePolicy(
        requestContext,
        companyModulePolicyId,
        input,
        actor.id,
        {
          emitAuditEvent: emitAdministrativeAuditEvent,
          requestId: req.requestId || null,
        },
      ),
    });
    return true;
  }

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

  const kioskDevicesId = locationPath(url.pathname, "/kiosk-devices");
  if (req.method === "GET" && kioskDevicesId) {
    sendJson(res, 200, { devices: await adminKioskDevices(requestContext, kioskDevicesId) });
    return true;
  }

  const registerKioskId = locationPath(url.pathname, "/kiosk-devices/register");
  if (req.method === "POST" && registerKioskId) {
    const input = registerKioskDeviceSchema.parse(await readBody(req));
    const registered = await registerAdminKioskDevice(requestContext, actor, registerKioskId, input);
    res.setHeader("set-cookie", kioskDeviceCookie(registered.token));
    res.setHeader("cache-control", "no-store");
    sendJson(res, 201, { device: registered.device });
    return true;
  }

  const revokeKiosk = locationKioskDevicePath(url.pathname, "/revoke");
  if (req.method === "POST" && revokeKiosk) {
    sendJson(res, 200, {
      device: await revokeAdminKioskDevice(
        requestContext,
        actor,
        revokeKiosk.locationId,
        revokeKiosk.deviceId,
      ),
    });
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
        {
          emitAuditEvent: emitAdministrativeAuditEvent,
          requestId: req.requestId || null,
        },
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
    sendJson(res, 201, await inviteLocationUser(requestContext, location.location, input, actor.id, origin));
    return true;
  }

  const userLocations = companyManagedUserPath(url.pathname, "/locations");
  if (req.method === "PUT" && userLocations) {
    const input = updateManagedUserLocationsSchema.parse(await readBody(req));
    sendJson(res, 200, {
      user: await updateAdminUserLocations(requestContext, actor, userLocations, input),
    });
    return true;
  }

  const userPasswordResetEmail = companyManagedUserPath(url.pathname, "/password-reset-email");
  if (req.method === "POST" && userPasswordResetEmail) {
    const input = requestManagedUserPasswordResetSchema.parse(await readBody(req));
    res.setHeader("cache-control", "no-store");
    sendJson(res, 200, {
      result: await requestAdminUserPasswordReset(
        requestContext,
        actor,
        userPasswordResetEmail,
        input,
        fromNodeHeaders(req.headers),
        invitationPublicOrigin(req),
      ),
    });
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

  const scopedUserPasswordResetEmail = managedUserPath(url.pathname, "/password-reset-email");
  if (req.method === "POST" && scopedUserPasswordResetEmail) {
    res.setHeader("cache-control", "no-store");
    sendJson(res, 200, {
      result: await requestAdminUserPasswordResetForLocation(
        requestContext,
        actor,
        scopedUserPasswordResetEmail.locationId,
        scopedUserPasswordResetEmail.userId,
        fromNodeHeaders(req.headers),
        invitationPublicOrigin(req),
      ),
    });
    return true;
  }

  const userKioskPin = managedUserPath(url.pathname, "/kiosk-pin");
  if (req.method === "POST" && userKioskPin) {
    const parsed = issueKioskPinSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      sendJson(res, 400, {
        error: parsed.error.issues[0]?.message || "Enter a valid PIN.",
        issues: parsed.error.issues,
      });
      return true;
    }
    sendJson(res, 200, {
      credential: await setAdminMechanicKioskPin(
        requestContext,
        actor,
        userKioskPin.locationId,
        userKioskPin.userId,
        parsed.data,
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
