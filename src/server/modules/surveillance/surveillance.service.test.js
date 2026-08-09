import assert from "node:assert/strict";
import test from "node:test";
import { categorizeSurveillanceRows } from "./surveillance.service.js";

test("surveillance queues active work separately from approved Odoo work", () => {
  const rows = [
    { id: "accepted", lifecycle: "accepted", odooStatus: "not_entered" },
    { id: "working", lifecycle: "in_progress", odooStatus: "not_entered" },
    { id: "review", lifecycle: "mechanic_done", odooStatus: "not_entered" },
    { id: "approved", lifecycle: "closed", odooStatus: "not_entered" },
    { id: "missing", lifecycle: "closed", odooStatus: "missing_info" },
    { id: "entered", lifecycle: "odoo_entered", odooStatus: "entered" },
  ];

  const queues = categorizeSurveillanceRows(rows);

  assert.deepEqual(queues.active.map((row) => row.id), ["accepted", "working"]);
  assert.deepEqual(queues.awaitingOffice.map((row) => row.id), ["review"]);
  assert.deepEqual(queues.pendingOdoo.map((row) => row.id), ["approved"]);
  assert.deepEqual(queues.missingInfo.map((row) => row.id), ["missing"]);
  assert.deepEqual(queues.entered.map((row) => row.id), ["entered"]);
});

test("active work never appears in Needs Odoo before office approval", () => {
  const queues = categorizeSurveillanceRows([
    { id: "working", lifecycle: "in_progress", odooStatus: "not_entered" },
  ]);

  assert.equal(queues.active.length, 1);
  assert.equal(queues.pendingOdoo.length, 0);
});
