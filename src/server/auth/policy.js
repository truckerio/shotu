import { PERMISSION } from "./permissions.js";

const PUBLIC_PATHS = new Set(["/api/config"]);

export function permissionForRequest(method, pathname) {
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return null;
  if (method === "GET" && /^\/api\/invitations\/[^/]+$/.test(pathname)) return null;
  if (method === "POST" && /^\/api\/invitations\/[^/]+\/accept$/.test(pathname)) return null;
  if (PUBLIC_PATHS.has(pathname) && method === "GET") return null;
  if (pathname === "/api/integrations/samsara/oauth/callback" && method === "GET") return null;
  if (pathname.startsWith("/api/integrations/")) return PERMISSION.INTEGRATION_ADMIN;
  if (pathname.startsWith("/api/admin/")) return PERMISSION.ADMIN_MANAGE;
  if (pathname.startsWith("/api/mechanic/chat-media/") && method === "GET") return PERMISSION.WORKORDER_CHAT_READ;
  if (pathname.startsWith("/api/mechanic/")) return PERMISSION.WORKORDER_MECHANIC;
  if (pathname.startsWith("/api/office/")) return PERMISSION.WORKORDER_OFFICE;
  if (pathname.startsWith("/api/surveillance/")) return PERMISSION.WORKORDER_SURVEILLANCE;
  if (pathname === "/api/parts-helper/live-prices") return PERMISSION.PART_PRICE;
  if (pathname.startsWith("/api/parts-helper/")) return PERMISSION.PART_IDENTIFY;
  if (pathname.startsWith("/api/vehicles/")) return pathname.endsWith("/live-location")
    ? PERMISSION.VEHICLE_LOCATION_REFRESH
    : PERMISSION.VEHICLE_READ;
  if (["/api/state", "/api/workorders", "/api/print", "/api/print-settings", "/api/upload", "/api/share", "/api/printers"].includes(pathname)) {
    return PERMISSION.PRINT_MANAGE;
  }
  if (pathname.startsWith("/api/jobs/")) return PERMISSION.PRINT_MANAGE;
  if (pathname === "/api/companies") return PERMISSION.LOCATION_ADMIN;
  if (pathname === "/api" || pathname.startsWith("/api/")) return PERMISSION.AUTHENTICATED;
  return undefined;
}
