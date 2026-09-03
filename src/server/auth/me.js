import { requireActor } from "./authorize.js";
import { resolveRequestContext } from "./context.js";
import { productModuleBootstrap } from "../modules/access/product-module-access.service.js";

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
  const resolveProductModules = helpers.productModuleBootstrap || productModuleBootstrap;
  helpers.sendJson(res, 200, {
    user: publicActor(actor),
    productModuleAccess: await resolveProductModules(context),
    sessionMode: context.sessionMode || "standard",
    kiosk: context.sessionMode === "kiosk" ? context.kiosk : null,
  });
  return true;
}
