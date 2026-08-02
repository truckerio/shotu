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
