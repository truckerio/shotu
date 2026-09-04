import { loadInspectionRefreshWindow } from "../inspections/inspection-api-model.js";

export const MECHANIC_INSPECTION_WINDOW = 100;

function loadInspectionStatusWindow(request, status) {
  return loadInspectionRefreshWindow(({ cursor, limit }) => {
    const params = new URLSearchParams({ status, limit:String(limit) });
    if (cursor) params.set("cursor", cursor);
    return request(`/api/inspections?${params}`);
  }, { loadedCount:MECHANIC_INSPECTION_WINDOW });
}

export async function loadMechanicWorkspaceData(request, { includeInspections = false } = {}) {
  const dashboardRequest = request("/api/mechanic/dashboard");
  const inspectionRequest = includeInspections
    ? Promise.all([
      loadInspectionStatusWindow(request, "not_completed"),
      loadInspectionStatusWindow(request, "completed"),
    ]).then(([active, completed]) => ({ items:[...(active.items || []), ...(completed.items || [])] }))
    : Promise.resolve({ items:[], nextCursor:"" });
  const [dashboard, inspections] = await Promise.allSettled([dashboardRequest, inspectionRequest]);
  return {
    dashboard: dashboard.status === "fulfilled" ? dashboard.value : null,
    inspections: inspections.status === "fulfilled" ? inspections.value : null,
    dashboardError: dashboard.status === "rejected" ? dashboard.reason : null,
    inspectionError: inspections.status === "rejected" ? inspections.reason : null,
  };
}
