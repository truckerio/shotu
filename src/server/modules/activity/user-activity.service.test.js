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
