import assert from "node:assert/strict";
import test from "node:test";
import { clampPartRequestPage, partRequestRowModel } from "./part-request-queue-model.js";

test("part request pagination returns to the last valid page after the queue shrinks", () => {
  assert.equal(clampPartRequestPage(3, 2), 2);
  assert.equal(clampPartRequestPage(0, 4), 1);
  assert.equal(clampPartRequestPage(2, 4), 2);
});

test("part request row model renders the canonical queue DTO without fallback aliases", () => {
  const row = partRequestRowModel({
    id: "request-1",
    workorderId: "workorder-1",
    part: { partNumber: "OF-001", description: "Engine oil filter", quantity: 10, uomCode: "ea" },
    workorder: { serial: "WO-100", unitLabel: "Truck 12" },
    destinationLocation: { locationId: "location-1", locationName: "Chino shop" },
    requester: { name: "Karan" },
    approvalStatus: "approved",
    supplySummary: "Partially available",
    suppliedQuantity: 2,
    availability: { localQuantity: 3, networkQuantity: 8 },
    waitingSeconds: 3600,
    updatedAt: "2026-08-26T00:00:00.000Z",
  });

  assert.deepEqual(row, {
    id: "request-1",
    workorderId: "workorder-1",
    partNumber: "OF-001",
    partDescription: "Engine oil filter",
    quantity: 10,
    unit: "ea",
    workorderLabel: "WO-100",
    unitLabel: "Truck 12",
    destination: "Chino shop",
    requester: "Karan",
    supply: "Partially available · Local 3 · Network 8 · 2 supplied",
    status: "approved",
    nextAction: "Review request",
    waitingSeconds: 3600,
    lastActivityAt: "2026-08-26T00:00:00.000Z",
  });
});

test("part request row model accepts the backend flat destination contract", () => {
  const row = partRequestRowModel({
    id: "request-2",
    workorderId: "workorder-2",
    partNumber: "FF-001",
    partDescription: "Fuel filter",
    quantity: 8,
    uomCode: "ea",
    destination: "Ontario shop",
    requesterName: "Office",
    status: "requested",
  });

  assert.equal(row.destination, "Ontario shop");
  assert.equal(row.partNumber, "FF-001");
  assert.equal(row.partDescription, "Fuel filter");
});
