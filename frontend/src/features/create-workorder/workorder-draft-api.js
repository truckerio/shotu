import { api } from "../../lib/api.js";

export async function createWorkorderDraft(payload) {
  const result = await api("/api/workorder-drafts", {
    method: "POST",
    body: JSON.stringify({
      type: "workorder",
      locationId: payload.locationId || null,
      payload,
    }),
  });
  return result.draft;
}

export async function updateWorkorderDraft(draftId, { version, payload }) {
  const result = await api(`/api/workorder-drafts/${encodeURIComponent(draftId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      version,
      locationId: payload.locationId || null,
      payload,
    }),
  });
  return result.draft;
}

export function discardWorkorderDraft(draftId) {
  return api(`/api/workorder-drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });
}
