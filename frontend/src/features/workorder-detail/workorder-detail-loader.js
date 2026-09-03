import { api } from "../../lib/api.js";

export function operationalDetailApiRole(role) {
  if (role === "admin" || role === "office") return "office";
  if (role === "mechanic") return "mechanic";
  return null;
}

export function workorderDetailEndpoint(role, workorderId) {
  const apiRole = operationalDetailApiRole(role);
  if (!apiRole) throw new Error("This role opens workorders from its own queue.");
  return `/api/${apiRole}/workorders/${encodeURIComponent(workorderId)}`;
}

export function inspectionContextEndpoint(workorderId) {
  return `/api/inspections/workorders/${encodeURIComponent(workorderId)}/context`;
}

export function inspectionContextSources(context = {}) {
  return (Array.isArray(context.sources) ? context.sources : [])
    .filter((source) => source?.inspectionId)
    .map((source) => ({
      inspectionId: source.inspectionId,
      inspectionNumber: source.inspectionNumber || "Inspection",
      completedAt: source.completedAt || "",
      result: source.result || "",
      eligible: source.eligible === true,
      blockerCode: source.blockerCode || "",
      blockerMessage: source.blockerMessage || "",
    }));
}

function inspectionContextIsAbsent(error) {
  return [403, 404].includes(error?.status || error?.statusCode);
}

export async function loadWorkorderDetail({
  markOpened = false,
  request = api,
  role,
  workorderId,
}) {
  const endpoint = workorderDetailEndpoint(role, workorderId);
  if (markOpened) {
    await request(`${endpoint}/opened`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }
  const detail = await request(endpoint);
  try {
    const result = await request(inspectionContextEndpoint(workorderId));
    const inspectionContext = result?.inspectionContext;
    return inspectionContext ? { ...detail, inspectionContext: { ...inspectionContext, sources: inspectionContextSources(inspectionContext) } } : detail;
  } catch (error) {
    if (inspectionContextIsAbsent(error)) return detail;
    return { ...detail, inspectionContextUnavailable: true };
  }
}
