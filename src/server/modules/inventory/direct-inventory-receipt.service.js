import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { getUnitDefinition } from "../../../../shared/units-of-measure.js";
import { findDirectReceiptPurchaseLine, findDirectReceiptOutcome, findDirectReceiptPart, listPartStockMovements, postLocalInventoryReceipt } from "../../db/repositories/local-inventory.repo.js";
import { closeDirectReceiptApprovalRequest, createDirectReceiptApprovalRequest, findDirectReceiptApprovalOutcome, loadDirectReceiptApprovalRequest, readDirectReceiptApprovalDetail } from "../../db/repositories/direct-receipt-approvals.repo.js";
import { InventoryError, inventoryNotFound } from "./inventory.errors.js";
import { query } from '../../db/pool.js';
import { effectiveInventoryScope, resolveInventoryLocationScope } from './inventory-effective-scope.js';
import { assertInventoryQrConfigured, inventoryTokenFromCode, readInventoryQrToken } from "./inventory-qr.js";
import { withInventoryLabels } from "./inventory-receiving.service.js";

export const directReceiptSchema = z.object({
  locationId: z.string().uuid(),
  catalogPartId: z.string().uuid().optional(),
  purchaseLineId: z.string().uuid().optional(),
  purchaseRequestId: z.string().uuid().optional(),
  expectedRequestVersion: z.number().int().positive().optional(),
  disposition:z.enum(['accepted','held']).optional(),
  holdLocation:z.string().trim().min(1).max(240).optional(),
  damageDetails:z.string().trim().min(1).max(500).optional(),
  targetPositionId: z.string().uuid().optional(),
  expectedPartVersion: z.number().int().positive().optional(),
  trackingMode: z.enum(["quantity", "serialized", "measured_bulk"]),
  uomCode: z.string().trim().min(1).max(24),
  quantity: z.number().positive().max(999999.999),
  serialNumbers: z.array(z.string().trim().min(1).max(100)).max(500).default([]),
  reference: z.string().trim().max(240).default(""),
  noPurchaseOrderReason: z.string().trim().max(500).default(""),
  idempotencyKey: z.string().uuid(),
  confirmation: z.literal("new_company_stock_received"),
}).strict().superRefine((value, ctx) => {
  if(!value.catalogPartId&&!value.purchaseLineId)ctx.addIssue({code:'custom',path:['catalogPartId'],message:'Choose a catalog part or purchase order line.'});
  if(value.catalogPartId&&!value.expectedPartVersion)ctx.addIssue({code:'custom',path:['expectedPartVersion'],message:'Refresh the catalog part.'});
  if(value.purchaseRequestId&&(!value.expectedRequestVersion||value.purchaseLineId||value.disposition==='held'))ctx.addIssue({code:'custom',path:['purchaseRequestId'],message:'An approved request requires its current version and an accepted receipt.'});
  if(value.disposition==='held'&&(!value.holdLocation||!value.damageDetails))ctx.addIssue({code:'custom',path:['holdLocation'],message:'Record the physical hold location and damage findings.'});
  if(value.disposition==='held'&&value.targetPositionId)ctx.addIssue({code:'custom',path:['targetPositionId'],message:'Held receipts cannot be placed into usable stock.'});
  if(!value.purchaseLineId&&!value.noPurchaseOrderReason)ctx.addIssue({code:'custom',path:['noPurchaseOrderReason'],message:'Explain why this arrival has no purchase order.'});
  const unit = getUnitDefinition(value.uomCode);
  if (!unit || unit.category === "time" || Math.round(value.quantity * 10 ** unit.decimalScale) / 10 ** unit.decimalScale !== value.quantity) {
    ctx.addIssue({ code: "custom", path: ["quantity"], message: "Enter a quantity in the part's stocking unit and allowed precision." });
  }
  if (value.trackingMode === "serialized") {
    if (!Number.isInteger(value.quantity) || value.quantity !== value.serialNumbers.length) ctx.addIssue({ code: "custom", path: ["serialNumbers"], message: "Capture one identity for every received unit." });
    if (new Set(value.serialNumbers.map((serial) => serial.toUpperCase())).size !== value.serialNumbers.length) ctx.addIssue({ code: "custom", path: ["serialNumbers"], message: "Each received identity must be different." });
  } else if (value.serialNumbers.length) ctx.addIssue({ code: "custom", path: ["serialNumbers"], message: "This part does not use individual serial identities." });
});

const scopeOptions={code:'INVENTORY_RECEIVE_FORBIDDEN',message:'Receiving requires Office or Admin access.'};
const locationScope=(context,locationId,dependencies)=>resolveInventoryLocationScope(context,locationId,{loadLocation:dependencies.loadLocation,...scopeOptions});
async function partScope(context,catalogPartId,dependencies){
  const load=dependencies.loadPartScope|| (async()=>{const result=await query('select company_id from parts_catalog where id=$1 and company_id=any($2::uuid[])',[catalogPartId,[...context.companyIds]]);return result.rows[0]||null;});
  const part=await load(catalogPartId,[...context.companyIds]);if(!part)throw inventoryNotFound();
  return effectiveInventoryScope(context,{companyId:part.company_id||part.companyId,...scopeOptions});
}
async function outcomeScope(context,idempotencyKey,dependencies){
  const load=dependencies.loadOutcomeScope|| (async()=>{const result=await query(`select company_id,location_id from local_inventory_receipts where company_id=any($1::uuid[]) and created_by=$2 and idempotency_key=$3 and source_type='direct'
    union all select company_id,location_id from inventory_direct_receipt_approval_requests where company_id=any($1::uuid[]) and submitted_by=$2 and idempotency_key=$3::uuid limit 1`,[[...context.companyIds],context.actor.id,idempotencyKey]);return result.rows[0]||null;});
  const receipt=await load(idempotencyKey,[...context.companyIds],context.actor.id);if(!receipt)return null;
  return effectiveInventoryScope(context,{companyId:receipt.company_id||receipt.companyId,locationId:receipt.location_id||receipt.locationId,...scopeOptions});
}
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function failure(code, message) { return new InventoryError(message, { code, statusCode: 409 }); }

export async function readPartStockMovements(catalogPartId, searchParams, context, dependencies = {}) {
  const id = z.string().uuid().parse(catalogPartId);
  const parsed = z.object({ locationId: z.string().uuid().optional(), view: z.enum(["audit", "workorder"]).default("audit"), page: z.coerce.number().int().min(1).max(100000).default(1) }).strict().parse(Object.fromEntries(searchParams));
  const authorized = parsed.locationId?await locationScope(context,parsed.locationId,dependencies):await partScope(context,id,dependencies);
  const part = await (dependencies.findPart || findDirectReceiptPart)({ ...authorized, catalogPartId: id });
  if (!part) throw inventoryNotFound();
  return (dependencies.listMovements || listPartStockMovements)({ ...authorized, catalogPartId: id, ...parsed });
}

export async function readDirectReceiptOutcome(key, context, dependencies = {}) {
  const idempotencyKey = z.string().uuid().parse(key);
  const authorized = await outcomeScope(context,idempotencyKey,dependencies);
  if(!authorized)return { status: "not_found" };
  const result = await (dependencies.findOutcome || findDirectReceiptOutcome)({ ...authorized, idempotencyKey });
  if (result) return { status: "posted", receipt: withInventoryLabels(result.receipt, dependencies.qrOptions) };
  const request = await (dependencies.findApprovalOutcome || findDirectReceiptApprovalOutcome)({ ...authorized, idempotencyKey });
  return request ? { status: request.status === "pending" ? "approval_needed" : request.status, approvalRequest: request } : { status: "not_found" };
}

export async function readDirectReceiptApproval(requestId, context, dependencies = {}) {
  const id = z.string().uuid().parse(requestId);
  const request = await (dependencies.loadApprovalRequest || loadDirectReceiptApprovalRequest)({
    requestId: id, companyIds: [...context.companyIds], locationIds: [], isAdmin: true,
  });
  if (!request) throw inventoryNotFound();
  const authorized = await locationScope(context, request.locationId, dependencies);
  const result = await (dependencies.readApprovalDetail || readDirectReceiptApprovalDetail)({
    requestId: id, companyIds: authorized.companyIds, locationIds: authorized.locationIds,
    isAdmin: authorized.isAdmin, actorId: context.actor.id,
  });
  if (result.kind === "not_found") throw inventoryNotFound();
  if (result.kind === "forbidden") throw new InventoryError("You cannot review this approval request.", { code: "INVENTORY_DIRECT_RECEIPT_APPROVAL_FORBIDDEN", statusCode: 403 });
  if (result.kind !== "found") throw new Error("Unexpected approval detail result.");
  return result.detail;
}

export async function receiveDirectInventory(input, context, dependencies = {}, approval = null) {
  const parsed = directReceiptSchema.parse(input);
  const authorized = await locationScope(context,parsed.locationId,dependencies);
  const requestHash = hash(parsed);
  const existing = approval ? null : await (dependencies.findOutcome || findDirectReceiptOutcome)({ ...authorized, idempotencyKey: parsed.idempotencyKey });
  if (existing) {
    if (existing.requestHash !== requestHash) throw failure("INVENTORY_RECEIPT_REPLAY_CONFLICT", "This receipt was already saved with different details.");
    return { receipt: withInventoryLabels(existing.receipt, dependencies.qrOptions), replayed: true };
  }
  if (!approval) {
    const pending = await (dependencies.findApprovalOutcome || findDirectReceiptApprovalOutcome)({ ...authorized, idempotencyKey: parsed.idempotencyKey });
    if (pending) {
      if (pending.requestHash !== requestHash) throw failure("INVENTORY_RECEIPT_REPLAY_CONFLICT", "This receipt was already saved with different details.");
      return { status: pending.status === "pending" ? "approval_needed" : pending.status, approvalRequest: pending, replayed: true };
    }
  }
  const part = parsed.catalogPartId ? await (dependencies.findPart || findDirectReceiptPart)({ ...authorized, catalogPartId: parsed.catalogPartId }) : await findDirectReceiptPurchaseLine({...authorized,purchaseLineId:parsed.purchaseLineId,locationId:parsed.locationId});
  if (!part) throw inventoryNotFound();
  if (!part.tracking_mode) throw failure("INVENTORY_TRACKING_REQUIRED", "Review this part's tracking before receiving stock.");
  if (part.uom_code !== parsed.uomCode || part.tracking_mode !== parsed.trackingMode || (parsed.catalogPartId && Number(part.version) !== parsed.expectedPartVersion)) throw failure("INVENTORY_CATALOG_PART_CHANGED", "Part details changed. Refresh the part before receiving.");
  const serialized = parsed.trackingMode === "serialized";
  if (serialized) {
    assertInventoryQrConfigured(dependencies.qrOptions);
    if (parsed.serialNumbers.some((serial) => readInventoryQrToken(inventoryTokenFromCode(serial), dependencies.qrOptions))) {
      throw failure("INVENTORY_SERIAL_ALREADY_EXISTS", "This shop QR already identifies a unit. Open the existing unit instead of receiving it again.");
    }
  }
  if (!approval && !parsed.purchaseLineId) {
    const approvalResult = await (dependencies.createApprovalRequest || createDirectReceiptApprovalRequest)({
      ...authorized,
      locationId: parsed.locationId,
      catalogPartId: parsed.catalogPartId,
      targetPositionId: parsed.targetPositionId,
      idempotencyKey: parsed.idempotencyKey,
      requestHash,
      originalCommand: parsed,
      receiverEvidence: { actorId: authorized.actorId, confirmation: parsed.confirmation, confirmationHash: hash({ actorId: authorized.actorId, ...parsed }) },
      partVersion: parsed.expectedPartVersion,
      trackingMode: parsed.trackingMode,
      uomCode: parsed.uomCode,
      serialNumbers: parsed.serialNumbers,
    });
    if (["pending", "replay"].includes(approvalResult.kind)) return { status: "approval_needed", approvalRequest: approvalResult.request, replayed: approvalResult.kind === "replay" };
    const approvalErrors = {
      conflict: ["INVENTORY_RECEIPT_REPLAY_CONFLICT", "This receipt was already saved with different details."],
      catalog_changed: ["INVENTORY_CATALOG_PART_CHANGED", "Part details changed. Refresh the part before receiving."],
      serial_conflict: ["INVENTORY_SERIAL_ALREADY_EXISTS", "A captured identity already exists in inventory. Open that unit instead of receiving it again."],
      target_position_invalid: ["INVENTORY_RECEIPT_POSITION_INVALID", "Choose an active stock-holding position at this shop."],
    };
    if (approvalResult.kind === "not_found") throw inventoryNotFound();
    if (approvalErrors[approvalResult.kind]) throw failure(...approvalErrors[approvalResult.kind]);
    if (approvalResult.kind !== "not_required") throw new Error("Unexpected approval request result.");
  }
  const receiptId = randomUUID();
  const result = await (dependencies.postReceipt || postLocalInventoryReceipt)({
    ...authorized, actorId: approval?.submittedBy || authorized.actorId, receiptId, runId: null, reviewedRunVersion: null,
    idempotencyKey: parsed.idempotencyKey, requestHash,
    direct: { locationId: parsed.locationId, reference: parsed.reference, noPurchaseOrderReason:parsed.noPurchaseOrderReason, purchaseLineId: parsed.purchaseLineId, purchaseRequestId:parsed.purchaseRequestId, expectedRequestVersion:parsed.expectedRequestVersion, disposition:parsed.disposition,holdLocation:parsed.holdLocation,damageDetails:parsed.damageDetails,targetPositionId:parsed.targetPositionId },
    physicalConfirmation: parsed.disposition==="held" ? "received_on_hold" : "all_received_undamaged", confirmationHash: hash({ actorId: authorized.actorId, ...parsed }),
    labelBatchId: serialized ? randomUUID() : null,
    lines: [{ id: randomUUID(), lineIndex: 0, catalogPartId: parsed.catalogPartId, expectedPartVersion: parsed.expectedPartVersion,
      partNumber: part.part_number, normalizedPartNumber: part.normalized_part_number, description: part.description,
      quantity: parsed.quantity, uomCode: part.uom_code, trackingMode: part.tracking_mode, unitCost: null, lineTotal: null,
      serializedUnits: parsed.serialNumbers.map((serialNumber, index) => ({ id: randomUUID(), ordinal: index + 1, serialNumber, conditionCode: "new" })),
    }],
    approval,
  });
  if (result.kind === "not_found") throw inventoryNotFound();
  const errors = {
    request_conflict: ['INVENTORY_REQUEST_RECEIPT_CONFLICT','The request changed, is not approved, or the received part, unit or quantity does not match. Refresh it before receiving.'],
    purchase_conflict: ["INVENTORY_PURCHASE_RECEIPT_CONFLICT", "This order changed, is not approved, or the received amount exceeds its outstanding quantity."],
    catalog_changed: ["INVENTORY_CATALOG_PART_CHANGED", "Part details changed. Refresh the part before receiving."],
    conflict: ["INVENTORY_RECEIPT_REPLAY_CONFLICT", "This receipt command is already used with different details."],
    serial_conflict: ["INVENTORY_SERIAL_ALREADY_EXISTS", "A captured identity already exists in inventory. Open that unit instead of receiving it again."],
    authority_conflict: ["INVENTORY_AUTHORITY_CONFLICT", "Existing reservations need inventory reconciliation before receiving."],
    authority_unmatched: ["INVENTORY_AUTHORITY_IDENTITY_UNMATCHED", "Existing stock identity needs inventory reconciliation before receiving."],
    target_position_invalid: ["INVENTORY_RECEIPT_POSITION_INVALID", "Choose an active stock-holding position at this shop."],
    approval_forbidden: ["INVENTORY_DIRECT_RECEIPT_APPROVAL_FORBIDDEN", "A configured purchase approver must approve this no-PO receipt."],
    approval_stale: ["INVENTORY_DIRECT_RECEIPT_APPROVAL_STALE", "This approval request changed or can no longer be approved. Refresh it."],
  };
  if (errors[result.kind]) {
    if (result.kind === "target_position_invalid") throw new InventoryError(errors[result.kind][1], { code: errors[result.kind][0], statusCode: 422 });
    if (result.kind === "approval_forbidden") throw new InventoryError(errors[result.kind][1], { code: errors[result.kind][0], statusCode: 403 });
    throw failure(...errors[result.kind]);
  }
  if (!["posted", "replay"].includes(result.kind)) throw new Error("Unexpected receipt result.");
  return { receipt: withInventoryLabels(result.receipt, dependencies.qrOptions), replayed: result.kind === "replay" };
}

const directReceiptDecisionSchema = z.object({
  action: z.enum(["approve", "reject", "cancel"]),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().max(500).default(""),
}).strict().superRefine((value, ctx) => {
  if (["reject", "cancel"].includes(value.action) && !value.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "Record the reason for this decision." });
});

export async function decideDirectReceiptApproval(requestId, input, context, dependencies = {}) {
  const id = z.string().uuid().parse(requestId);
  const decision = directReceiptDecisionSchema.parse(input);
  const request = await (dependencies.loadApprovalRequest || loadDirectReceiptApprovalRequest)({
    requestId: id, companyIds: [...context.companyIds], locationIds: [], isAdmin: true,
  });
  if (!request) throw inventoryNotFound();
  const authorized = await locationScope(context, request.locationId, dependencies);
  if (decision.action !== "approve") {
    const result = await (dependencies.closeApprovalRequest || closeDirectReceiptApprovalRequest)({
      requestId: id, companyIds: authorized.companyIds, locationIds: authorized.locationIds, isAdmin: authorized.isAdmin,
      actorId: context.actor.id, expectedVersion: decision.expectedVersion, action: decision.action, reason: decision.reason,
    });
    if (result.kind === "not_found") throw inventoryNotFound();
    if (result.kind === "forbidden") throw new InventoryError("You cannot make this approval decision.", { code: "INVENTORY_DIRECT_RECEIPT_APPROVAL_FORBIDDEN", statusCode: 403 });
    if (result.kind === "stale") throw failure("INVENTORY_DIRECT_RECEIPT_APPROVAL_STALE", "This approval request changed. Refresh it.");
    return { status: result.request.status, approvalRequest: result.request };
  }
  if (request.status !== "pending" || request.version !== decision.expectedVersion) throw failure("INVENTORY_DIRECT_RECEIPT_APPROVAL_STALE", "This approval request changed. Refresh it.");
  const originalCommand = directReceiptSchema.parse(request.originalCommand);
  if (hash(originalCommand) !== request.requestHash) throw failure("INVENTORY_DIRECT_RECEIPT_APPROVAL_STALE", "The stored receipt command failed its integrity check.");
  return receiveDirectInventory(originalCommand, context, dependencies, {
    requestId: request.id,
    expectedVersion: request.version,
    submittedBy: request.submittedBy,
    approverActorId: context.actor.id,
    reason: decision.reason,
  });
}
