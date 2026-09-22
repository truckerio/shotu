import assert from "node:assert/strict";
import test from "node:test";
import {
  inventoryTaskDetailUrl,
  inventoryTaskQueueUrl,
  isRecoverableTaskError,
  recoveredTaskFeedback,
  taskAgeLabel,
  taskAssignmentBody,
  taskOwnerLabel,
  taskSelectionFromSearch,
} from "./inventory-task-queue-model.js";

const task = { sourceType: "position_recount", sourceId: "task-1", sourceVersion: "8", assignmentVersion: 2, location: { id: "shop-1" } };

test("task queue URLs preserve supported filters and exact detail scope", () => {
  assert.equal(inventoryTaskQueueUrl({ view: "all", locationId: "shop-1", sourceType: "position_recount", search: " A-1 ", page: 3 }), "/api/office/inventory/task-queue?view=all&page=3&locationId=shop-1&sourceType=position_recount&search=A-1");
  assert.equal(inventoryTaskDetailUrl(task), "/api/office/inventory/task-queue/position_recount/task-1?locationId=shop-1");
});

test("task queue presents compact server age and friendly ownership", () => {
  assert.equal(taskAgeLabel(12), "Just now");
  assert.equal(taskAgeLabel(7_200), "2h");
  assert.equal(taskAgeLabel(172_800), "2d");
  assert.equal(taskOwnerLabel({ assignedUser: { displayName: "Pat Lee" } }), "Pat Lee");
  assert.equal(taskOwnerLabel({ owner: { kind: "capability", role: "office" } }), "Office team");
});

test("assignment commands retain source and assignment concurrency versions", () => {
  assert.deepEqual(taskAssignmentBody(task, "claim", "command-key"), {
    action: "claim", locationId: "shop-1", sourceType: "position_recount", sourceId: "task-1",
    sourceVersion: "8", expectedAssignmentVersion: 2, idempotencyKey: "command-key", reason: "Claimed from Inventory Tasks",
  });
  assert.equal(isRecoverableTaskError({ code: "INVENTORY_TASK_ASSIGNMENT_STALE" }), true);
  assert.equal(isRecoverableTaskError({ code: "INVENTORY_TASK_FORBIDDEN" }), false);
  assert.deepEqual(recoveredTaskFeedback(), { error: "", notice: "Task refreshed. Review the current owner and action." });
});

test("reload selection requires the full tenant-safe task locator", () => {
  assert.deepEqual(taskSelectionFromSearch(new URLSearchParams("queueTaskType=damage_inspection&queueTaskId=abc&queueTaskLocation=shop")), { sourceType: "damage_inspection", sourceId: "abc", location: { id: "shop" } });
  assert.equal(taskSelectionFromSearch(new URLSearchParams("queueTaskType=damage_inspection&queueTaskId=abc")), null);
});
