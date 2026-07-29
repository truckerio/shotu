import { requireActor } from "./authorize.js";
import { resolveRequestContext } from "./context.js";

function publicActor(actor) {
  return {
    id: actor.id,
    name: actor.name,
    email: actor.email,
    phone: actor.phone,
    role: actor.role,
    locationIds: actor.locationIds || [],
    companyMemberships: actor.companyMemberships || [],
  };
}

export async function handleCurrentUserApi(req, res, url, helpers) {
  if (req.method !== "GET" || url.pathname !== "/api/me") return false;
  const resolveContext = helpers.resolveRequestContext || resolveRequestContext;
  const context = await resolveContext(req);
  const actor = requireActor(context);
  helpers.sendJson(res, 200, {
    user: publicActor(actor),
    sessionMode: context.sessionMode || "standard",
    kiosk: context.sessionMode === "kiosk" ? context.kiosk : null,
  });
  return true;
}
