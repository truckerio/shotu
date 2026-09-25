import assert from "node:assert/strict";
import test from "node:test";
import { beginUserActivityLoad, userActivityTimelineItem } from "./user-activity-model.js";

test("inventory movements become signed shared timeline records", () => {
  const item = userActivityTimelineItem({ id: "move-1", source: "inventory_movement", category: "inventory", action: "issue", actorName: "Alex", actorRole: "office", createdAt: "2026-09-24T12:00:00Z", quantityDelta: -2, uomCode: "ea", partNumber: "P-1", locationName: "Chino", workorderSerial: "WO-1", description: "Used on repair" });
  assert.equal(item.title, "Inventory removed");
  assert.equal(item.description, "Used on repair");
  assert.deepEqual(item.details, [
    { label: "Part", value: "P-1" }, { label: "Quantity", value: "−2 ea" },
    { label: "Location", value: "Chino" }, { label: "Workorder", value: "WO-1" },
  ]);
});

test("part creation and workorder updates keep identifiable record details", () => {
  const part = userActivityTimelineItem({ id: "part-1", source: "part_created", category: "parts", action: "created", actorName: "Alex", actorRole: "office", partNumber: "NEW-1", description: "Filter" });
  const workorder = userActivityTimelineItem({ id: "wo-1", source: "workorder_field", category: "workorders", action: "work_details_updated", actorName: "Alex", actorRole: "office", workorderSerial: "WO-1", description: "Work details" });
  assert.equal(part.title, "Inventory part created");
  assert.deepEqual(part.details, [{ label: "Part", value: "NEW-1" }]);
  assert.equal(workorder.title, "Work details updated");
  assert.deepEqual(workorder.details, [{ label: "Workorder", value: "WO-1" }]);
});

test("changing the activity filter keeps current rows until replacement data arrives", () => {
  const current = { items: [{ id: "event-1" }], page: 4, total: 81, hasMore: true, loading: false, loadingMore: true, error: "Old error" };
  assert.deepEqual(beginUserActivityLoad(current), {
    items: [{ id: "event-1" }],
    page: 1,
    total: 81,
    hasMore: true,
    loading: true,
    loadingMore: false,
    error: "",
  });
});
