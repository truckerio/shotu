import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  allocationNextStatuses,
  PartAllocationConflictError,
  PartWorkflowConflictError,
  publicAllocation,
  validateAllocationCoverage,
  validateInitialAllocationStatuses,
} from "./part-requests.repo.js";

const repositoryUrl = new URL("./part-requests.repo.js", import.meta.url);

test("Office part planning persists request sourcing evidence without appending printable used parts", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  const planned = source.slice(source.indexOf("export async function createPlannedOfficePart"), source.indexOf("function learnedAliases"));
  const legacy = source.slice(source.indexOf("export async function createApprovedOfficePart"), source.indexOf("export async function createPlannedOfficePart"));

  assert.match(planned, /appendToWorkorder: false/);
  assert.match(planned, /eventType: "office_planned"/);
  assert.match(planned, /systemMessage: "Office planned approved part"/);
  assert.match(planned, /if \(appendToWorkorder\) await appendOfficeAddedPart/);
  assert.match(legacy, /appendToWorkorder: true/);
  assert.match(legacy, /eventType: "office_added"/);
});

test("repository rejects direct callers whose allocation coverage does not match the request", () => {
  assert.throws(
    () => validateAllocationCoverage(1, "ea", [{ quantity: 100, uomCode: "ea" }]),
    /Supply quantities must equal the approved quantity/,
  );
  assert.throws(
    () => validateAllocationCoverage(1, "ea", [{ quantity: 1, uomCode: "gal" }]),
    /Supply unit must match the approved quantity unit/,
  );
  assert.doesNotThrow(() => validateAllocationCoverage(1, "ea", []));
  assert.throws(
    () => validateInitialAllocationStatuses([{ sourceType: "inventory", status: "issued" }]),
    /Initial inventory supply status must be valid for its source/,
  );
  assert.doesNotThrow(() => validateInitialAllocationStatuses([
    { sourceType: "inventory", status: "reserved" },
    { sourceType: "customer_supplied", status: "received" },
  ]));
});

test("allocation transitions are server-authoritative and terminal states expose no next step", () => {
  assert.deepEqual(allocationNextStatuses({ sourceType: "inventory", status: "proposed", inventoryItemId: "stock-1" }), ["reserved", "cancelled"]);
  assert.deepEqual(allocationNextStatuses({ sourceType: "inventory", status: "reserved", inventoryItemId: "stock-1" }), ["issued", "cancelled"]);
  assert.deepEqual(allocationNextStatuses({ sourceType: "purchase", status: "ordered", inventoryItemId: null }), ["received", "cancelled"]);
  assert.deepEqual(allocationNextStatuses({ sourceType: "transfer", status: "transferred", inventoryItemId: null }), ["issued", "cancelled"]);
  assert.deepEqual(allocationNextStatuses({ sourceType: "purchase", status: "installed", inventoryItemId: null }), []);
  const error = new PartAllocationConflictError("PART_ALLOCATION_TRANSITION_INVALID", "invalid");
  assert.equal(error.statusCode, 409);
  assert.equal(error.code, "PART_ALLOCATION_TRANSITION_INVALID");
  const workflowError = new PartWorkflowConflictError("PART_USAGE_WORKORDER_TERMINAL", "terminal");
  assert.equal(workflowError.statusCode, 409);
  assert.equal(workflowError.code, "PART_USAGE_WORKORDER_TERMINAL");
});

test("decision and usage mutations reject terminal workorders before request, activity, or chat writes", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  const decision = source.slice(source.indexOf("export async function decidePartRequest"), source.indexOf("async function applyInventoryAllocationTransition"));
  const usage = source.slice(source.indexOf("export async function updatePartUsage"));

  assert.match(decision, /PART_DECISION_WORKORDER_TERMINAL/);
  assert.ok(decision.indexOf("PART_DECISION_WORKORDER_TERMINAL") < decision.indexOf("update workorder_part_requests set"));
  assert.match(usage, /PART_USAGE_READ_ONLY/);
  assert.doesNotMatch(usage, /update workorder_part_requests set usage_status/);
  assert.doesNotMatch(usage, /addPartEvent/);
  assert.doesNotMatch(usage, /addSystemMessage/);
});

test("legacy mechanic usage entry point fails closed before any database mutation", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  const usage = source.slice(source.indexOf("export async function updatePartUsage"));

  assert.match(usage, /PART_USAGE_READ_ONLY/);
  assert.doesNotMatch(usage, /getPool\(\)/);
  assert.doesNotMatch(usage, /client\.query/);
  assert.doesNotMatch(usage, /update workorder_part_requests/);
});

test("allocation updates reject terminal workorders before inventory, allocation, or activity writes", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  const update = source.slice(source.indexOf("export async function updatePartAllocation"), source.indexOf("export async function updatePartUsage"));

  assert.match(update, /join operational_workorders wo on wo\.id = pr\.workorder_id/);
  assert.match(update, /TERMINAL_WORKORDER_STATUSES\.includes\(allocation\.workorder_status\)/);
  assert.match(update, /PART_ALLOCATION_WORKORDER_TERMINAL/);
  assert.ok(
    update.indexOf("PART_ALLOCATION_WORKORDER_TERMINAL") < update.indexOf("applyInventoryAllocationTransition"),
    "terminal rejection must occur before an inventory balance mutation",
  );
  assert.ok(
    update.indexOf("PART_ALLOCATION_WORKORDER_TERMINAL") < update.indexOf("update part_allocations set status"),
    "terminal rejection must occur before allocation status and activity writes",
  );
});

test("public allocations derive next statuses from database-shaped rows", () => {
  assert.deepEqual(publicAllocation({
    id: "allocation-1",
    source_type: "inventory",
    status: "reserved",
    quantity: 1,
    uom_code: "ea",
    inventory_item_id: "stock-1",
  }).nextStatuses, ["issued", "cancelled"]);
  assert.deepEqual(publicAllocation({
    id: "allocation-2",
    source_type: "purchase",
    status: "proposed",
    quantity: 1,
    uom_code: "ea",
    inventory_item_id: null,
  }).nextStatuses, ["ordered", "cancelled"]);
});
