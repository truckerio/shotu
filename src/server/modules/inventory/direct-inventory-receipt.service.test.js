import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { decideDirectReceiptApproval, directReceiptSchema, receiveDirectInventory, readDirectReceiptApproval, readDirectReceiptOutcome, readPartStockMovements } from "./direct-inventory-receipt.service.js";
import { handleInventoryApi } from "./inventory.routes.js";
import { createInventoryQrToken } from "./inventory-qr.js";

const locationId = randomUUID();
const companyId = randomUUID();
const catalogPartId = randomUUID();
const targetPositionId = randomUUID();
const context = { actor: { id: randomUUID(), role: "office" }, companyIds: new Set([companyId]), locationIds: new Set([locationId]) };
const input = () => ({ locationId, catalogPartId, expectedPartVersion: 1, trackingMode: "quantity", uomCode: "ea", quantity: 2, idempotencyKey: randomUUID(), confirmation: "new_company_stock_received", noPurchaseOrderReason: "Received without a purchase order" });
function dependencies(extra = {}) {
  return { loadLocation: async () => ({ id:locationId,company_id:companyId }), loadPartScope: async () => ({ companyId }), loadOutcomeScope:async()=>null, findOutcome: async () => null, findApprovalOutcome: async () => null, createApprovalRequest: async () => ({ kind: "not_required" }), findPart: async () => ({ id: catalogPartId, version: 1, tracking_mode: "quantity", uom_code: "ea", part_number: "FILTER", normalized_part_number: "FILTER", description: "Filter" }), ...extra };
}

test("standalone direct receipt requires a no-PO reason while a purchase-line receipt does not", () => {
  assert.throws(() => directReceiptSchema.parse({ ...input(), noPurchaseOrderReason: "" }));
  assert.doesNotThrow(() => directReceiptSchema.parse({ ...input(), purchaseLineId: randomUUID(), noPurchaseOrderReason: "" }));
});
test("part movement history defaults to audit and forwards the optional Workorder view", async () => {
  const calls = [];
  const deps = dependencies({ listMovements: async (value) => { calls.push(value); return { page: value.page, hasMore: false, items: [] }; } });
  await readPartStockMovements(catalogPartId, new URLSearchParams(), context, deps);
  await readPartStockMovements(catalogPartId, new URLSearchParams({ locationId, view: "workorder", page: "2" }), context, deps);
  assert.equal(calls[0].view, "audit");
  assert.equal(calls[0].page, 1);
  assert.equal(calls[1].view, "workorder");
  assert.equal(calls[1].locationId, locationId);
  assert.equal(calls[1].page, 2);
  await assert.rejects(readPartStockMovements(catalogPartId, new URLSearchParams({ view: "usage" }), context, deps));
});
test("direct receiving uses existing receipt owner, scoped location and unknown cost without invoice", async () => {
  let command;
  const result = await receiveDirectInventory(input(), context, dependencies({ postReceipt: async (value) => { command = value; return { kind: "posted", receipt: { id: value.receiptId, units: [] } }; } }));
  assert.equal(result.replayed, false);
  assert.equal(command.runId, null);
  assert.equal(command.direct.locationId, locationId);
  assert.equal(command.direct.targetPositionId, undefined);
  assert.equal(command.direct.noPurchaseOrderReason, "Received without a purchase order");
  assert.deepEqual(command.companyIds, [companyId]);
  assert.equal(command.actorId, context.actor.id);
  assert.equal(command.lines[0].unitCost, null);
  assert.equal(command.lines[0].lineTotal, null);
  assert.deepEqual(command.lines[0].serializedUnits, []);
});
test("an unauthorized no-PO receiver gets a durable approval request without posting stock", async () => {
  const payload = input();
  const request = { id: randomUUID(), status: "pending", requestHash: "stored", version: 1 };
  let postCalls = 0;
  const result = await receiveDirectInventory(payload, context, dependencies({
    createApprovalRequest: async (command) => {
      assert.equal(command.originalCommand.idempotencyKey, payload.idempotencyKey);
      assert.equal(command.receiverEvidence.actorId, context.actor.id);
      return { kind: "pending", request };
    },
    postReceipt: async () => { postCalls += 1; },
  }));
  assert.equal(result.status, "approval_needed");
  assert.equal(result.approvalRequest.id, request.id);
  assert.equal(postCalls, 0);
});
test("direct receipt forwards an optional exact target position and maps an invalid target", async () => {
  const payload = { ...input(), targetPositionId };
  let command;
  await assert.rejects(
    receiveDirectInventory(payload, context, dependencies({ postReceipt: async (value) => { command = value; return { kind: "target_position_invalid" }; } })),
    (error) => error.code === "INVENTORY_RECEIPT_POSITION_INVALID" && error.statusCode === 422,
  );
  assert.equal(command.direct.targetPositionId, targetPositionId);
});
test("exact receipt replay is recovered before mutable catalog validation", async () => {
  const payload = input();
  let stored;
  await receiveDirectInventory(payload, context, dependencies({ postReceipt: async (command) => { stored = { requestHash: command.requestHash, receipt: { id: command.receiptId, units: [] } }; return { kind: "posted", receipt: stored.receipt }; } }));
  const replayDependencies = dependencies({ loadOutcomeScope:async()=>({companyId,locationId}),findOutcome: async () => stored, findPart: async () => { throw new Error("Replay must not re-read changed catalog"); } });
  assert.equal((await receiveDirectInventory(payload, context, replayDependencies)).replayed, true);
  await assert.rejects(receiveDirectInventory({ ...payload, quantity: 3 }, context, replayDependencies), { code: "INVENTORY_RECEIPT_REPLAY_CONFLICT" });
});
test("receiving rejects role, location, unknown tracking and stale catalog before posting", async () => {
  await assert.rejects(receiveDirectInventory(input(), { ...context, actor: { ...context.actor, role: "mechanic" } }, dependencies()), { code: "INVENTORY_RECEIVE_FORBIDDEN" });
  await assert.rejects(receiveDirectInventory(input(), { ...context, locationIds: new Set() }, {}));
  await assert.rejects(receiveDirectInventory(input(), context, dependencies({ findPart: async () => ({ tracking_mode: null }) })), { code: "INVENTORY_TRACKING_REQUIRED" });
  await assert.rejects(receiveDirectInventory({ ...input(), expectedPartVersion: 2 }, context, dependencies()), { code: "INVENTORY_CATALOG_PART_CHANGED" });
});
test("receiving uses the target-company role instead of a higher primary role", async () => {
  const mixed={...context,actor:{...context.actor,role:'admin'},companyRoles:new Map([[companyId,'mechanic']])};
  await assert.rejects(receiveDirectInventory(input(),mixed,dependencies()),{code:'INVENTORY_RECEIVE_FORBIDDEN'});
  const targetOffice={...mixed,companyRoles:new Map([[companyId,'office']]),locationIds:new Set()};
  await assert.rejects(receiveDirectInventory(input(),targetOffice,dependencies()),{code:'inventory_not_found'});
});
test("tracking validation rejects inferred identities, duplicate scans and wrong precision", () => {
  for (const bad of [
    { trackingMode: "serialized", serialNumbers: [] },
    { trackingMode: "serialized", serialNumbers: ["A", "a"] },
    { serialNumbers: ["X"] },
    { quantity: 0 }, { quantity: 1.5 }, { confirmation: undefined },
  ]) assert.equal(directReceiptSchema.safeParse({ ...input(), ...bad }).success, false);
  assert.equal(directReceiptSchema.safeParse({ ...input(), trackingMode: "measured_bulk", uomCode: "gal", quantity: 1.125 }).success, true);
  assert.equal(directReceiptSchema.safeParse({ ...input(), disposition: "held", holdLocation: "Quarantine", damageDetails: "Bent housing", targetPositionId }).success, false);
});
test("serial receiving keeps scanned physical identities and maps duplicate identity conflicts", async () => {
  const payload = { ...input(), trackingMode: "serialized", serialNumbers: ["A1", "A2"] };
  const deps = dependencies({ findPart: async () => ({ id: catalogPartId, version: 1, tracking_mode: "serialized", uom_code: "ea" }), postReceipt: async (command) => {
    assert.deepEqual(command.lines[0].serializedUnits.map((unit) => unit.serialNumber), ["A1", "A2"]);
    return { kind: "serial_conflict" };
  } });
  await assert.rejects(receiveDirectInventory(payload, context, deps), { code: "INVENTORY_SERIAL_ALREADY_EXISTS" });
});
test("outcome lookup derives actor scope and distinguishes absence without posting", async () => {
  const idempotencyKey = randomUUID();
  const result = await readDirectReceiptOutcome(idempotencyKey, context, { loadOutcomeScope:async()=>({companyId,locationId}),findOutcome: async (value) => { assert.equal(value.actorId, context.actor.id); assert.equal(value.idempotencyKey, idempotencyKey); return null; },findApprovalOutcome:async()=>null });
  assert.deepEqual(result, { status: "not_found" });
});

test("approval posts the immutable original command with receiver and approver evidence", async () => {
  const requestId=randomUUID(),approverId=context.actor.id,submittedBy=randomUUID(),payload=input();
  const requestHash=createHash("sha256").update(JSON.stringify(directReceiptSchema.parse(payload))).digest("hex");
  let posted;
  const result=await decideDirectReceiptApproval(requestId,{action:"approve",expectedVersion:3,reason:"Approved arrival"},context,dependencies({
    loadApprovalRequest:async()=>({id:requestId,locationId,status:"pending",version:3,requestHash,originalCommand:payload,submittedBy}),
    postReceipt:async(command)=>{posted=command;return {kind:"posted",receipt:{id:command.receiptId,units:[]}};},
  }));
  assert.equal(result.receipt.id,posted.receiptId);
  assert.equal(posted.actorId,submittedBy);
  assert.deepEqual(posted.approval,{requestId,expectedVersion:3,submittedBy,approverActorId:approverId,reason:"Approved arrival"});
});

test("approval detail requires exact shop scope and current approver policy", async () => {
  const requestId = randomUUID();
  const detail = { approvalRequest: { id: requestId, status: "pending", version: 1 }, arrival: { quantity: 2, uomCode: "ea", disposition: "held", holdLocation: "Receiving cage", damageDetails: "Bent housing" } };
  const result = await readDirectReceiptApproval(requestId, context, dependencies({
    loadApprovalRequest: async () => ({ id: requestId, locationId }),
    readApprovalDetail: async (command) => {
      assert.equal(command.actorId, context.actor.id);
      assert.deepEqual(command.locationIds, [locationId]);
      return { kind: "found", detail };
    },
  }));
  assert.deepEqual(result, detail);
  assert.deepEqual(result.arrival,{quantity:2,uomCode:"ea",disposition:"held",holdLocation:"Receiving cage",damageDetails:"Bent housing"});
  await assert.rejects(readDirectReceiptApproval(requestId, context, dependencies({
    loadApprovalRequest: async () => ({ id: requestId, locationId }),
    readApprovalDetail: async () => ({ kind: "forbidden" }),
  })), { code: "INVENTORY_DIRECT_RECEIPT_APPROVAL_FORBIDDEN", statusCode: 403 });
  await assert.rejects(readDirectReceiptApproval(requestId, { ...context, locationIds: new Set() }, dependencies({
    loadApprovalRequest: async () => ({ id: requestId, locationId }),
  })), { code: "inventory_not_found" });
});

test("the HTTP handler dispatches direct receipt creation, recovery and validation", async () => {
  const payload = input();
  const helpers = { requestContext: context, readBody: async () => payload, sendJson: (res, status, body) => Object.assign(res, { status, body }) };
  const response = {};
  assert.equal(await handleInventoryApi({ method: "POST" }, response, new URL("http://localhost/api/office/inventory/direct-receipts"), helpers, dependencies({ postReceipt: async () => ({ kind: "posted", receipt: { id: "saved", units: [] } }) })), true);
  assert.equal(response.status, 200);
  assert.equal(response.body.receipt.id, "saved");
  const recovery = {};
  await handleInventoryApi({ method: "GET" }, recovery, new URL(`http://localhost/api/office/inventory/direct-receipts/${payload.idempotencyKey}`), helpers, dependencies());
  assert.deepEqual(recovery.body, { status: "not_found" });
  const invalid = {};
  await handleInventoryApi({ method: "POST" }, invalid, new URL("http://localhost/api/office/inventory/direct-receipts"), { ...helpers, readBody: async () => ({}) }, dependencies());
  assert.equal(invalid.status, 400);
});

test("an existing shop QR cannot be registered as a new physical serial", async () => {
  const qrOptions = { signingKey: Buffer.alloc(32, 9).toString("base64") };
  const token = createInventoryQrToken(randomUUID(), qrOptions);
  await assert.rejects(receiveDirectInventory({ ...input(), trackingMode: "serialized", quantity: 1, serialNumbers: [token] }, context,
    dependencies({ qrOptions, findPart: async () => ({ id: catalogPartId, version: 1, tracking_mode: "serialized", uom_code: "ea" }) })), { code: "INVENTORY_SERIAL_ALREADY_EXISTS" });
});
