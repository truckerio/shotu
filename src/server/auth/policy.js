import { PERMISSION } from "./permissions.js";

const PUBLIC_PATHS = new Set(["/api/config"]);

export function permissionForRequest(method, pathname) {
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return null;
  if (method === "GET" && /^\/api\/invitations\/[^/]+$/.test(pathname)) return null;
  if (method === "POST" && /^\/api\/invitations\/[^/]+\/accept$/.test(pathname)) return null;
  if (PUBLIC_PATHS.has(pathname) && method === "GET") return null;
  if (pathname === "/api/kiosk/context" && method === "GET") return null;
  if (pathname === "/api/integrations/samsara/oauth/callback" && method === "GET") return null;
  if (pathname.startsWith("/api/integrations/odoo/v1/")) return null;
  if (pathname.startsWith("/api/integrations/")) return PERMISSION.INTEGRATION_ADMIN;
  if (pathname.startsWith("/api/admin/")) return PERMISSION.ADMIN_MANAGE;
  if (pathname.startsWith("/api/mechanic/chat-media/") && method === "GET") return PERMISSION.WORKORDER_CHAT_READ;
  if (pathname.startsWith("/api/mechanic/")) return PERMISSION.WORKORDER_MECHANIC;
  if (method === "POST" && /^\/api\/office\/inventory\/count-imports\/[^/]+\/apply$/.test(pathname)) {
    return PERMISSION.INVENTORY_COUNT_APPLY;
  }
  if (method === "POST" && /^\/api\/office\/inventory\/position-counts\/[^/]+\/apply$/.test(pathname)) {
    return PERMISSION.INVENTORY_COUNT_APPLY;
  }
  if (
    (method === "POST" && /^\/api\/office\/inventory\/locations\/[^/]+\/(positions|position-counts)$/.test(pathname))
    || (method === "PATCH" && /^\/api\/office\/inventory\/positions\/[^/]+$/.test(pathname))
    || (method === "POST" && /^\/api\/office\/inventory\/parts\/[^/]+\/locations\/[^/]+\/moves$/.test(pathname))
    || (method === "PUT" && /^\/api\/office\/inventory\/position-counts\/[^/]+\/lines\/[^/]+$/.test(pathname))
  ) return PERMISSION.INVENTORY_LOCATION_MANAGE;
  if (method === "GET" && /^\/api\/office\/inventory\/parts\/[^/]+\/commercial$/.test(pathname)) {
    return PERMISSION.INVENTORY_COST_READ;
  }
  if ((method === "GET" && pathname === "/api/office/inventory/tax-profiles")
    || (method === "POST" && /^\/api\/office\/inventory\/parts\/[^/]+\/pricing-preview$/.test(pathname))) {
    return PERMISSION.INVENTORY_COST_READ;
  }
  if ((method === "POST" && pathname === "/api/office/inventory/tax-profiles")
    || (method === "PUT" && /^\/api\/office\/inventory\/tax-profiles\/[^/]+$/.test(pathname))
    || (method === "PATCH" && /^\/api\/office\/inventory\/tax-profiles\/[^/]+\/archive$/.test(pathname))) {
    return PERMISSION.INVENTORY_PRICE_WRITE;
  }
  if (["PUT", "PATCH"].includes(method) && /^\/api\/office\/inventory\/parts\/[^/]+\/prices\/(internal|selling)$/.test(pathname)) {
    return PERMISSION.INVENTORY_PRICE_WRITE;
  }
  if (pathname.startsWith("/api/office/")) return PERMISSION.WORKORDER_OFFICE;
  if (pathname.startsWith("/api/workorder-drafts")) return PERMISSION.WORKORDER_OFFICE;
  if (pathname.startsWith("/api/surveillance/")) return PERMISSION.WORKORDER_SURVEILLANCE;
  if (pathname === "/api/workorders" && method === "POST") return PERMISSION.AUTHENTICATED;
  if (pathname === "/api/workorders/create-context" && method === "GET") return PERMISSION.AUTHENTICATED;
  if (method === "GET" && /^\/api\/workorders\/[^/]+\/print-archives$/.test(pathname)) return PERMISSION.PRINT_MANAGE;
  if (pathname === "/api/parts-helper/live-prices") return PERMISSION.PART_PRICE;
  if (pathname.startsWith("/api/parts-helper/")) return PERMISSION.PART_IDENTIFY;
  if (method === "POST" && pathname === "/api/vehicles/manual") return PERMISSION.VEHICLE_MANUAL_CREATE;
  if (pathname.startsWith("/api/vehicles/")) return pathname.endsWith("/live-location")
    ? PERMISSION.VEHICLE_LOCATION_REFRESH
    : PERMISSION.VEHICLE_READ;
  if (["/api/state", "/api/workorders", "/api/print", "/api/print-settings", "/api/upload", "/api/share"].includes(pathname)) {
    return PERMISSION.PRINT_MANAGE;
  }
  if (pathname.startsWith("/api/jobs/")) return PERMISSION.PRINT_MANAGE;
  if (pathname === "/api/companies") return PERMISSION.LOCATION_ADMIN;
  if (pathname === "/api" || pathname.startsWith("/api/")) return PERMISSION.AUTHENTICATED;
  return undefined;
}
