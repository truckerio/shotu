import { workorderPreferencesSchema } from "../modules/workorders/workorder-preferences.schemas.js";
import {
  loadWorkorderPreferences,
  updateWorkorderPreferences,
} from "../modules/workorders/workorder-preferences.service.js";

export async function handleWorkorderPreferencesApi(req, res, url, helpers) {
  if (url.pathname !== "/api/workorder-preferences") return false;
  const { readBody, requestContext, sendJson } = helpers;

  if (req.method === "GET") {
    sendJson(res, 200, { preferences: await loadWorkorderPreferences(requestContext) });
    return true;
  }

  if (req.method === "PUT") {
    const input = workorderPreferencesSchema.parse(await readBody(req));
    sendJson(res, 200, { preferences: await updateWorkorderPreferences(requestContext, input) });
    return true;
  }

  return false;
}
