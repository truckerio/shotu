import { fromNodeHeaders } from "better-auth/node";
import { getAuthActorByAuthUserId } from "../db/repositories/auth-users.repo.js";
import { auth } from "./auth.js";
import { permissionsForRole } from "./permissions.js";

function anonymousContext(session = null) {
  return {
    session,
    actor: null,
    permissions: new Set(),
    locationIds: new Set(),
    companyIds: new Set(),
    companyRoles: new Map(),
  };
}

export async function resolveRequestContext(req, dependencies = {}) {
  const getSession = dependencies.getSession || ((headers) => auth.api.getSession({ headers }));
  const getActor = dependencies.getActor || getAuthActorByAuthUserId;
  const headers = dependencies.headers || fromNodeHeaders(req.headers);
  const session = await getSession(headers);
  if (!session?.user?.id) return anonymousContext();

  const actor = await getActor(session.user.id);
  if (!actor?.active) return anonymousContext(session);

  return {
    session,
    actor,
    permissions: permissionsForRole(actor.role),
    locationIds: new Set(actor.locationIds || []),
    companyIds: new Set(actor.companyIds || []),
    companyRoles: new Map((actor.companyMemberships || []).map((membership) => [membership.companyId, membership.role])),
  };
}
