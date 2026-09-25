import { getUserActivity } from "../modules/activity/user-activity.service.js";

export async function handleActivityApi(req, res, url, helpers, dependencies = {}) {
  if (url.pathname !== "/api/activity") return false;
  if (req.method !== "GET") return false;
  const loadActivity = dependencies.getUserActivity || getUserActivity;
  const query = {
    category: url.searchParams.get("category") || "",
    page: url.searchParams.get("page") || "1",
    pageSize: url.searchParams.get("pageSize") || "50",
  };
  helpers.sendJson(res, 200, await loadActivity(helpers.requestContext, query));
  return true;
}
