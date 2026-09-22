import assert from "node:assert/strict";
import test from "node:test";
import { transferAllocationMatchesQuantity, transferDispatchPayload, transferNextStep, transferReceiptPayload, transferStatus } from "./inventory-transfer-model.js";

test("transfer presentation keeps the routine state human-readable", () => {
  assert.deepEqual(transferStatus({ status: "in_transit" }), { label: "In transit", tone: "info" });
  assert.deepEqual(transferStatus({ transfer_state: "returning" }), { label: "Returning to source", tone: "attention" });
  assert.equal(transferNextStep({ destination_id: "destination", status: "in_transit" }, "destination"), "Count or scan what arrived, then put away the good goods.");
});

test("transfer command models carry optimistic versions and physical placement", () => {
  assert.deepEqual(transferDispatchPayload({ locationId: "source", catalogPartId: "part", quantity: "2", expectedBalanceRevision: "7", destinationId: "destination", reason: "restock", holder: "driver", sourceAllocations: [{ positionId: "bin", quantity: 2 }], blindReceiving: true }), { action: "transfer", locationId: "source", catalogPartId: "part", quantity: 2, expectedBalanceRevision: "7", destinationId: "destination", reason: "restock", holder: "driver", serialNumbers: [], sourceAllocations: [{ positionId: "bin", quantity: 2 }], blindReceiving: true });
  assert.deepEqual(transferReceiptPayload({ task: { id: "task", version: 3 }, locationId: "destination", quantity: "1", reason: "received", holder: "dock", targetPositionId: "bin" }), { action: "receive_transfer", taskId: "task", locationId: "destination", expectedVersion: 3, quantity: 1, reason: "received", holder: "dock", serialNumbers: [], targetPositionId: "bin", disposition: "good" });
});

test("measured allocations compare at the stocking unit precision", () => {
  assert.equal(transferAllocationMatchesQuantity([{ quantity: 0.1 }, { quantity: 0.2 }], 0.3, "gal"), true);
  assert.equal(transferAllocationMatchesQuantity([{ quantity: 0.1 }, { quantity: 0.19 }], 0.3, "gal"), false);
  assert.equal(transferAllocationMatchesQuantity([{ quantity: 1 }], 2, "ea"), false);
});
