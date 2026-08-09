import { canCreateWorkorderForRole } from "../../../../shared/workorder-modules.js";

const ROLE_CAPABILITIES = Object.freeze({
  admin: Object.freeze({
    canAssignCreateWorkorder: true,
    canManageDrafts: true,
    canPrintWorkorder: true,
    createMode: "admin",
    defaultWorkspace: "admin",
    detailSource: "office",
  }),
  office: Object.freeze({
    canAssignCreateWorkorder: true,
    canManageDrafts: true,
    canPrintWorkorder: true,
    createMode: "admin",
    defaultWorkspace: "office",
    detailSource: "office",
  }),
  mechanic: Object.freeze({
    canAssignCreateWorkorder: false,
    canManageDrafts: false,
    canPrintWorkorder: false,
    createMode: "mechanic",
    defaultWorkspace: "mechanic",
    detailSource: "mechanic",
  }),
  surveillance: Object.freeze({
    canAssignCreateWorkorder: false,
    canManageDrafts: false,
    canPrintWorkorder: false,
    createMode: "admin",
    defaultWorkspace: "surveillance",
    detailSource: "surveillance",
  }),
});

export function roleCapabilities(role) {
  return ROLE_CAPABILITIES[role] || Object.freeze({
    canAssignCreateWorkorder: false,
    canManageDrafts: false,
    canPrintWorkorder: false,
    createMode: "admin",
    defaultWorkspace: "office",
    detailSource: null,
  });
}

export function roleCanCreateWorkorder(role, policy = null, userId = "") {
  return canCreateWorkorderForRole(role, policy, userId);
}

export function roleCanCreateWorkorderForAnyLocation(role, locations = [], userId = "") {
  if (!locations.length) return roleCanCreateWorkorder(role, null, userId);
  return locations.some((entry) => roleCanCreateWorkorder(role, entry.policy, userId));
}

export function roleCanOpenOperationalDetail(role) {
  return role === "admin" || role === "office" || role === "mechanic";
}
