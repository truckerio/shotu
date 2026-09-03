export function currentRouteParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function replaceRouteSearch(search = "") {
  if (typeof window === "undefined") return;
  window.history.replaceState({}, "", `${window.location.pathname}${search}`);
}

const INSPECTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function inspectionReturnContext(value = currentRouteParams()) {
  const read = typeof value?.get === "function"
    ? (key) => value.get(key)
    : (key) => value?.[key];
  const inspectionId = read("inspectionId") || read("inspection");
  const anchor = read("anchor");
  if (read("from") !== "inspection" || !["summary", "reinspect"].includes(anchor) || !INSPECTION_ID_PATTERN.test(inspectionId || "")) {
    return null;
  }
  return { inspectionId, anchor };
}

function inspectionReturnSearch(inspectionReturn) {
  const context = inspectionReturnContext(inspectionReturn);
  return context ? `&from=inspection&inspection=${encodeURIComponent(context.inspectionId)}&anchor=${context.anchor}` : "";
}

export function inspectionWorkspaceSearch(role, inspectionId, anchor = "summary") {
  return workspaceSearchForRole(role, { inspectionReturn: { from: "inspection", inspectionId, anchor } });
}

export function workorderDetailSearch(workorderId, section = "", { partRequestId = "", inspectionReturn = null } = {}) {
  const encodedId = encodeURIComponent(workorderId);
  const sectionQuery = section && section !== "work"
    ? `&section=${encodeURIComponent(section)}`
    : "";
  const partRequestQuery = partRequestId
    ? `&partRequest=${encodeURIComponent(partRequestId)}`
    : "";
  return `?workorder=${encodedId}${sectionQuery}${partRequestQuery}${inspectionReturnSearch(inspectionReturn)}`;
}

export function createWorkorderSearch(draftId = "") {
  return draftId
    ? `?view=create&draft=${encodeURIComponent(draftId)}`
    : "?view=create";
}

export function draftsSearch() {
  return "?view=drafts";
}

export function defaultWorkspaceForRole(role) {
  if (role === "admin") return "admin";
  if (role === "surveillance") return "surveillance";
  if (role === "mechanic") return "mechanic";
  return "office";
}

// Detail/create navigation has a stable landing view per role. Admins own
// several workspace views; operations is the workorder queue and therefore
// the only correct destination for the workorder back action.
export function workspaceSearchForRole(role, { inspectionReturn = null } = {}) {
  const returnQuery = inspectionReturnSearch(inspectionReturn);
  if (role === "admin") return `?adminView=operations${returnQuery}`;
  return returnQuery ? `?${returnQuery.slice(1)}` : "";
}

export function readInitialWorkspace(actor) {
  const params = currentRouteParams();
  if ((actor.role === "office" || actor.role === "admin") && (params.has("workorder") || params.get("view") === "create")) return "generator";
  if (actor.role === "mechanic" && (params.has("workorder") || params.get("view") === "create")) return "generator";
  return defaultWorkspaceForRole(actor.role);
}

export function routeStartsLoading() {
  const params = currentRouteParams();
  return params.has("workorder") || params.has("draft");
}
