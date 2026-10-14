import assert from "node:assert/strict";
import test from "node:test";
import { getUserActivity } from "./user-activity.service.js";

test("activity service adds only the authenticated actor presentation", async () => {
  const context = { actor: { id: "actor-1", name: "Alex Rivera", role: "office" } };
  const result = await getUserActivity(context, {}, { listActivity: async () => ({ items: [{ id: "event-1", source: "inventory_movement", category: "inventory", action: "issue", created_at: "2026-09-24T12:00:00Z", quantity_delta: "-2.000", uom_code: "ea", part_number: "P-1", location_name: "Shop", workorder_id: "wo-1", workorder_serial: "WO-1" }], page: 1, pageSize: 50, total: 1, hasMore: false }) });
  assert.deepEqual(result.items[0], {
    id: "event-1", source: "inventory_movement", category: "inventory", action: "issue",
    createdAt: "2026-09-24T12:00:00Z", actorName: "Alex Rivera", actorRole: "office",
    recordId: undefined, recordLabel: undefined, partNumber: "P-1", description: undefined,
    quantityDelta: -2, uomCode: "ea", locationId: undefined, locationName: "Shop",
    workorderId: "wo-1", workorderSerial: "WO-1",
  });
});

test("activity presentation uses the effective role for each company", async () => {
  const context = {
    actor: { id: "actor-1", name: "Alex Rivera", role: "admin" },
    companyIds: new Set(["company-a", "company-b"]),
    companyRoles: new Map([["company-a", "admin"], ["company-b", "mechanic"]]),
  };
  const result = await getUserActivity(context, {}, { listActivity: async () => ({
    items: [{ id: "event-1", company_id: "company-b" }], page: 1, pageSize: 50, total: 1, hasMore: false,
  }) });
  assert.equal(result.items[0].actorRole, "mechanic");
});

test("downgraded company activity omits pricing events and their amount metadata", async () => {
  const context = {
    actor: { id: "actor-1", name: "Alex Rivera", role: "admin" },
    companyIds: new Set(["company-a", "company-b", "company-c"]),
    companyRoles: new Map([["company-a", "admin"], ["company-b", "mechanic"], ["company-c", "surveillance"]]),
  };
  const result = await getUserActivity(context, {}, { listActivity: async () => ({
    items: [
      { id: "safe", company_id: "company-b", source: "workorder_status", action: "in_progress", description: "Started" },
      { id: "price", company_id: "company-b", source: "workorder_field", action: "pricing.customerTotal", description: "changed from 10.00 to 999.00", metadata: { oldAmount: "10.00", newAmount: "999.00" } },
      { id: "surveillance-price", company_id: "company-c", source: "workorder_field", action: "pricing.internalCost", description: "changed from 1.00 to 777.00", metadata: { newAmount: "777.00" } },
      { id: "admin-price", company_id: "company-a", source: "workorder_field", action: "pricing.customerTotal", description: "changed from 10.00 to 20.00" },
    ], page: 1, pageSize: 50, total: 3, hasMore: false,
  }) });
  assert.deepEqual(result.items.map((item) => item.id), ["safe", "admin-price"]);
  assert.equal(JSON.stringify(result.items).includes("999.00"), false);
  assert.equal(JSON.stringify(result.items).includes("777.00"), false);
});
