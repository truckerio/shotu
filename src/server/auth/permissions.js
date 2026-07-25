export const PERMISSION = Object.freeze({
  AUTHENTICATED: "authenticated",
  WORKORDER_CHAT_READ: "workorder:chat-read",
  WORKORDER_MECHANIC: "workorder:mechanic",
  WORKORDER_OFFICE: "workorder:office",
  WORKORDER_SURVEILLANCE: "workorder:surveillance",
  PART_IDENTIFY: "part:identify",
  PART_PRICE: "part:price",
  VEHICLE_READ: "vehicle:read",
  VEHICLE_LOCATION_REFRESH: "vehicle:location-refresh",
  PRINT_MANAGE: "print:manage",
  INTEGRATION_ADMIN: "integration:admin",
  USER_ADMIN: "user:admin",
  LOCATION_ADMIN: "location:admin",
  ADMIN_MANAGE: "admin:manage",
});

const ROLE_PERMISSIONS = Object.freeze({
  mechanic: new Set([
    PERMISSION.AUTHENTICATED,
    PERMISSION.WORKORDER_CHAT_READ,
    PERMISSION.WORKORDER_MECHANIC,
    PERMISSION.PART_IDENTIFY,
    PERMISSION.VEHICLE_READ,
    PERMISSION.VEHICLE_LOCATION_REFRESH,
  ]),
  office: new Set([
    PERMISSION.AUTHENTICATED,
    PERMISSION.WORKORDER_CHAT_READ,
    PERMISSION.WORKORDER_OFFICE,
    PERMISSION.PART_IDENTIFY,
    PERMISSION.PART_PRICE,
    PERMISSION.VEHICLE_READ,
    PERMISSION.VEHICLE_LOCATION_REFRESH,
    PERMISSION.PRINT_MANAGE,
  ]),
  surveillance: new Set([PERMISSION.AUTHENTICATED, PERMISSION.WORKORDER_SURVEILLANCE]),
  admin: new Set(Object.values(PERMISSION)),
});

export function permissionsForRole(role) {
  return new Set(ROLE_PERMISSIONS[role] || []);
}

export function roleHasPermission(role, permission) {
  return ROLE_PERMISSIONS[role]?.has(permission) || false;
}
