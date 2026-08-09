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
  expectedVersion,
  recordActivity,
}) {
  return api(`/api/mechanic/workorders/${encodeURIComponent(workorderId)}/progress`, {
    method: "PATCH",
    body: JSON.stringify({
      diagnosis,
      workPerformed,
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
  expectedVersion,
  recordActivity,
}, request = api) {
  if (role === "mechanic") {
    return updateMechanicProgress({
      workorderId,
      diagnosis,
      workPerformed,
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
        expectedVersion,
        recordActivity,
      }),
    },
  );
  return response.result;
}
