const ROLE_CAPABILITIES = Object.freeze({
  admin: Object.freeze({
    canAssignCreateWorkorder: true,
    canManageDrafts: true,
    canPrintWorkorder: true,
    createMode: "admin",
    defaultWorkspace: "admin",
    detailSource: "office",
    templateApiRole: "office",
  }),
  office: Object.freeze({
    canAssignCreateWorkorder: true,
    canManageDrafts: true,
    canPrintWorkorder: true,
    createMode: "admin",
    defaultWorkspace: "office",
    detailSource: "office",
    templateApiRole: "office",
  }),
  mechanic: Object.freeze({
    canAssignCreateWorkorder: false,
    canManageDrafts: false,
    canPrintWorkorder: false,
    createMode: "mechanic",
    defaultWorkspace: "mechanic",
    detailSource: "mechanic",
    templateApiRole: "mechanic",
  }),
  surveillance: Object.freeze({
    canAssignCreateWorkorder: false,
    canManageDrafts: false,
    canPrintWorkorder: false,
    createMode: "admin",
    defaultWorkspace: "surveillance",
    detailSource: "surveillance",
    templateApiRole: null,
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
    templateApiRole: null,
  });
}

export function roleCanOpenOperationalDetail(role) {
  return role === "admin" || role === "office" || role === "mechanic";
}
