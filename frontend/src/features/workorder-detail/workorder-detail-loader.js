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
  return request(endpoint);
}
