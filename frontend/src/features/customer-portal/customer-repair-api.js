import { api } from "../../lib/api.js";
import { customerDocumentCommandKey } from "../customer-documents/customer-estimate-api.js";

export function repairGrantFromLocation(location = window.location) {
  return new URLSearchParams(String(location.hash || "").replace(/^#/, "")).get("customerRepair") || "";
}
export function repairHeaders(grant) {
  if (!grant) throw new Error("This customer link is unavailable.");
  return { "x-customer-repair-grant": grant };
}
export const repairRequestKey = () => customerDocumentCommandKey("repair");
const staffPath = (workorderId) => `/api/customer-repair/workorders/${encodeURIComponent(workorderId)}`;
export const createRepairLink = ({ workorderId, ...input }) => api(`${staffPath(workorderId)}/links`, { method: "POST", body: JSON.stringify(input) });
export const emailRepairLink = ({ grantId, ...input }) => api(`/api/customer-repair/links/${encodeURIComponent(grantId)}/email`, { method: "POST", timeoutMs: 25000, body: JSON.stringify(input) });
export const revokeRepairLink = ({ grantId, ...input }) => api(`/api/customer-repair/links/${encodeURIComponent(grantId)}/revoke`, { method: "POST", body: JSON.stringify(input) });
export const loadRepairPortal = (grant) => api("/api/customer-repair/portal", { headers: repairHeaders(grant), timeoutMs: 15000 });
export const respondRepairEstimate = (grant, input) => api("/api/customer-repair/portal/responses", { method: "POST", headers: repairHeaders(grant), body: JSON.stringify(input), timeoutMs: 15000 });
export const loadRepairChat = (grant) => api("/api/customer-repair/portal/chat", { headers: repairHeaders(grant), timeoutMs: 15000 });
export const sendRepairChat = (grant, input) => api("/api/customer-repair/portal/chat", { method: "POST", headers: repairHeaders(grant), body: JSON.stringify(input), timeoutMs: 15000 });
export const loadStaffRepairChat = ({ companyId, locationId, workorderId }) => api(`${staffPath(workorderId)}/chat?${new URLSearchParams({ companyId, locationId })}`);
export const sendStaffRepairChat = ({ workorderId, ...input }) => api(`${staffPath(workorderId)}/chat`, { method: "POST", body: JSON.stringify(input) });
