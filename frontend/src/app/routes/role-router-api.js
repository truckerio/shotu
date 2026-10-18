import { api } from "../../lib/api.js";

export {
  createWorkorderDraft,
  discardWorkorderDraft,
  updateWorkorderDraft,
} from "../../features/create-workorder/workorder-draft-api.js";

export function updateMechanicProgress({
  workorderId,
  diagnosis,
  workPerformed,
  laborHours,
  concern,
  expectedVersion,
  recordActivity,
}, request = api) {
  return request(`/api/mechanic/workorders/${encodeURIComponent(workorderId)}/progress`, {
    method: "PATCH",
    body: JSON.stringify({
      diagnosis,
      workPerformed,
      laborHours,
      concern,
      expectedVersion,
      recordActivity,
    }),
  });
}

export async function updateDetailDiagnosisRepair({
  role,
  workorderId,
  diagnosis,
  workPerformed,
  laborHours,
  concern,
  expectedVersion,
  recordActivity,
}, request = api) {
  if (role === "mechanic") {
    return updateMechanicProgress({
      workorderId,
      diagnosis,
      workPerformed,
      laborHours,
      concern,
      expectedVersion,
      recordActivity,
    }, request);
  }

  const response = await request(
    `/api/workorders/${encodeURIComponent(workorderId)}/modules/diagnosisRepair`,
    {
      method: "PATCH",
      body: JSON.stringify({
        diagnosis,
        workPerformed,
        laborHours,
        expectedVersion,
        recordActivity,
      }),
    },
  );
  return response.result;
}
