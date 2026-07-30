export function currentRouteParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function replaceRouteSearch(search = "") {
  if (typeof window === "undefined") return;
  window.history.replaceState({}, "", `${window.location.pathname}${search}`);
}

export function workorderDetailSearch(workorderId, section = "") {
  const encodedId = encodeURIComponent(workorderId);
  const sectionQuery = section && section !== "work"
    ? `&section=${encodeURIComponent(section)}`
    : "";
  return `?workorder=${encodedId}${sectionQuery}`;
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
