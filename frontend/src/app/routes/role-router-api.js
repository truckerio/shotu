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
  expectedVersion,
  recordActivity,
}) {
  return api(`/api/mechanic/workorders/${encodeURIComponent(workorderId)}/progress`, {
    method: "PATCH",
    body: JSON.stringify({
      diagnosis,
      workPerformed,
      laborHours,
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
  expectedVersion,
  recordActivity,
}, request = api) {
  if (role === "mechanic") {
    return updateMechanicProgress({
      workorderId,
      diagnosis,
      workPerformed,
      laborHours,
      expectedVersion,
      recordActivity,
    });
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
