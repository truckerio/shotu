import { fromNodeHeaders } from "better-auth/node";
import { getAuthActorByAuthUserId } from "../db/repositories/auth-users.repo.js";
import { auth } from "./auth.js";
import { permissionsForRole } from "./permissions.js";
import { getKioskSessionContext } from "../db/repositories/kiosk.repo.js";

function anonymousContext(session = null) {
  return {
    session,
    actor: null,
    permissions: new Set(),
    locationIds: new Set(),
    companyIds: new Set(),
    companyRoles: new Map(),
    sessionMode: null,
    kiosk: null,
  };
}

export async function resolveRequestContext(req, dependencies = {}) {
  const getSession = dependencies.getSession || ((headers) => auth.api.getSession({ headers }));
  const getActor = dependencies.getActor || getAuthActorByAuthUserId;
  const getKioskSession = dependencies.getKioskSession || getKioskSessionContext;
  const headers = dependencies.headers || fromNodeHeaders(req.headers);
  const session = await getSession(headers);
  if (!session?.user?.id) return anonymousContext();

  const actor = await getActor(session.user.id);
  if (!actor?.active) return anonymousContext(session);
  const kioskSession = await getKioskSession(session.session?.id);
  if (kioskSession?.invalid) return anonymousContext(session);

  if (kioskSession) {
    const kioskActor = {
      ...actor,
      role: "mechanic",
      locationId: kioskSession.locationId,
      locationIds: [kioskSession.locationId],
      companyIds: [kioskSession.companyId],
      companyMemberships: [{ companyId: kioskSession.companyId, role: "mechanic" }],
    };
    return {
      session,
      actor: kioskActor,
      permissions: permissionsForRole("mechanic"),
      locationIds: new Set([kioskSession.locationId]),
      companyIds: new Set([kioskSession.companyId]),
      companyRoles: new Map([[kioskSession.companyId, "mechanic"]]),
      sessionMode: "kiosk",
      kiosk: {
        deviceId: kioskSession.deviceId,
        locationId: kioskSession.locationId,
      },
    };
  }

  const companyIds = new Set(actor.companyIds || []);
  const companyRoles = new Map((actor.companyMemberships || [])
    .filter((membership) => companyIds.has(membership.companyId))
    .map((membership) => [membership.companyId, membership.role]));
  // Route permissions are an admission gate only. Target-company policy remains
  // authoritative at each resource/list boundary; do not drop secondary roles.
  const permissions = new Set([...companyRoles.values()].flatMap((role) => [...permissionsForRole(role)]));
  return {
    session,
    actor,
    permissions,
    locationIds: new Set(actor.locationIds || []),
    companyIds,
    companyRoles,
    sessionMode: "standard",
    kiosk: null,
  };
}
