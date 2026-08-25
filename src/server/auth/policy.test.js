import assert from "node:assert/strict";
import test from "node:test";
import { PERMISSION } from "./permissions.js";
import { permissionForRequest } from "./policy.js";

test("public auth and OAuth callback routes require no app permission", () => {
  assert.equal(permissionForRequest("POST", "/api/auth/sign-in/username"), null);
  assert.equal(permissionForRequest("GET", "/api/integrations/samsara/oauth/callback"), null);
  assert.equal(permissionForRequest("GET", "/api/invitations/token"), null);
  assert.equal(permissionForRequest("POST", "/api/invitations/token/accept"), null);
  assert.equal(permissionForRequest("GET", "/api/kiosk/context"), null);
});

test("route families map to domain permissions", () => {
  assert.equal(permissionForRequest("GET", "/api/mechanic/dashboard"), PERMISSION.WORKORDER_MECHANIC);
  assert.equal(permissionForRequest("PATCH", "/api/office/workorders/1"), PERMISSION.WORKORDER_OFFICE);
  assert.equal(permissionForRequest("GET", "/api/office/invoice-extractions/run-1/source"), PERMISSION.WORKORDER_OFFICE);
  assert.equal(permissionForRequest("GET", "/api/workorder-drafts"), PERMISSION.WORKORDER_OFFICE);
  assert.equal(permissionForRequest("POST", "/api/workorder-drafts/1/takeover"), PERMISSION.WORKORDER_OFFICE);
  assert.equal(permissionForRequest("POST", "/api/integrations/samsara/sync"), PERMISSION.INTEGRATION_ADMIN);
  assert.equal(permissionForRequest("POST", "/api/parts-helper/live-prices"), PERMISSION.PART_PRICE);
  assert.equal(permissionForRequest("GET", "/api/parts-helper/catalog"), PERMISSION.PART_IDENTIFY);
  assert.equal(permissionForRequest("GET", "/api/parts-helper/repair-suggestions"), PERMISSION.PART_IDENTIFY);
  assert.equal(permissionForRequest("GET", "/api/vehicles/1"), PERMISSION.VEHICLE_READ);
  assert.equal(permissionForRequest("POST", "/api/vehicles/1/live-location"), PERMISSION.VEHICLE_LOCATION_REFRESH);
  assert.equal(permissionForRequest("GET", "/api/jobs/job-1/pdf"), PERMISSION.PRINT_MANAGE);
  assert.equal(permissionForRequest("GET", "/api/print-settings"), PERMISSION.PRINT_MANAGE);
  assert.equal(permissionForRequest("GET", "/api/printers"), PERMISSION.AUTHENTICATED);
  assert.equal(permissionForRequest("POST", "/api/proofreading/check"), PERMISSION.AUTHENTICATED);
  assert.equal(permissionForRequest("POST", "/api/companies"), PERMISSION.LOCATION_ADMIN);
  assert.equal(permissionForRequest("GET", "/api/mechanic/chat-media/attachment-1"), PERMISSION.WORKORDER_CHAT_READ);
  assert.equal(permissionForRequest("GET", "/api/unknown"), PERMISSION.AUTHENTICATED);
  assert.equal(
    permissionForRequest("GET", "/api/workorders/workorder-1/modules/odoo/readiness"),
    PERMISSION.AUTHENTICATED,
  );
  assert.equal(permissionForRequest("GET", "/api/admin/locations"), PERMISSION.ADMIN_MANAGE);
  assert.equal(permissionForRequest("POST", "/api/kiosk/event"), PERMISSION.AUTHENTICATED);
});
