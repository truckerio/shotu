import { z } from "zod";
import { acknowledgeChatReceiptsSchema } from "../chat/chat-receipts.schemas.js";
import {
  createOfficePartSchema,
  createPartRequestSchema,
  decidePartRequestSchema,
  updatePartAllocationSchema,
  updatePartUsageSchema,
} from "../parts/part.schemas.js";
import {
  assignMechanicsSchema,
  cancelWorkorderSchema,
  closeWorkorderSchema,
  markDoneSchema,
  reassignWorkorderSchema,
  releaseWorkorderSchema,
  returnWorkorderSchema,
  sendMessageSchema,
  updateMechanicUsedPartsSchema,
  amendLegacyManualPartEvidenceSchema,
  laborProductSchema,
} from "./workorder.schemas.js";
import { mechanicProgressSchema } from "../mechanic/mechanic-progress.schemas.js";
import { updateSerializedUsageRepairOrderSchema } from "../inventory/inventory-unit-workorder.schemas.js";
import {
  createOdooDraftSchema,
  mapOdooWorkorderPartSchema,
  prepareOdooWorkorderSchema,
} from "../../integrations/odoo/odoo.outbound.schemas.js";

const expectedUpdatedAt = z.string().datetime().optional();
const formPatch = (shape) => z.object({
  formData: z.object(shape).strict().optional(),
  expectedUpdatedAt,
}).strict();

const PATCH_SCHEMAS = Object.freeze({
  unit: z.object({
    assetId: z.string().uuid().nullable().optional(),
    formData: z.object({
      customerCompanyName: z.string().trim().max(300).optional(),
      companyName: z.string().trim().max(300).optional(),
      unitNo: z.string().trim().max(200).optional(),
      unitType: z.string().trim().max(120).optional(),
      licenseNo: z.string().trim().max(200).optional(),
      mileage: z.union([z.string(), z.number()]).optional(),
      model: z.string().trim().max(300).optional(),
      vinNo: z.string().trim().max(200).optional(),
    }).strict().optional(),
    expectedUpdatedAt,
  }).strict(),
  location: z.object({ locationId: z.string().uuid().nullable(), expectedUpdatedAt }).strict(),
  schedule: formPatch({
    workStartDate: z.string().trim().max(40).optional(),
    workEndDate: z.string().trim().max(40).optional(),
    startTime: z.string().trim().max(40).optional(),
    endTime: z.string().trim().max(40).optional(),
  }),
  assignment: formPatch({
    mechanicName: z.string().trim().max(500).optional(),
    customerSignature: z.string().trim().max(300).optional(),
    authorizedBy: z.string().trim().max(300).optional(),
  }),
  concern: z.object({
    concern: z.string().trim().min(1).max(2000).optional(),
    officeNotes: z.string().trim().max(4000).optional(),
    formData: z.object({ mechanicConcern: z.string().trim().max(2000).optional() }).strict().optional(),
    expectedUpdatedAt,
  }).strict(),
  diagnosisRepair: mechanicProgressSchema.extend({
    formData: z.object({
      laborProduct: laborProductSchema.nullable(),
    }).strict().optional(),
  }),
});

const id = z.string().uuid();
const customUnitPrice = z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/).optional();
const partDecision = decidePartRequestSchema.extend({ requestId: id });

const ACTIONS = Object.freeze({
  assignment: Object.freeze({
    accept: z.object({}).strict(),
    release: releaseWorkorderSchema,
    assign: assignMechanicsSchema,
    reassign: reassignWorkorderSchema,
  }),
  diagnosisRepair: Object.freeze({
    record: z.discriminatedUnion("operation", [
      z.object({
        operation: z.literal("laborRateRevision"),
        productId: id,
        locationId: id.nullable().optional(),
        priceKind: z.enum(["internal_cost", "selling_price"]),
        expectedVersion: z.number().int().min(0),
        amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/).nullable(),
        currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
        reason: z.string().trim().min(2).max(500),
        idempotencyKey: z.string().trim().min(8).max(160),
      }).strict(),
      z.object({
        operation: z.literal("laborPriceSelection"),
        customUnitPrice,
        selection: z.enum(["internal_cost", "selling_price"]),
        expectedRateVersionId: id.optional(),
        reason: z.string().trim().min(2).max(500),
        idempotencyKey: z.string().trim().min(8).max(160),
      }).strict(),
    ]),
  }),
  parts: Object.freeze({
    request: createPartRequestSchema,
    record: z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("usedParts"), ...updateMechanicUsedPartsSchema.shape }),
      amendLegacyManualPartEvidenceSchema,
      z.object({ operation: z.literal("usage"), requestId: id, ...updatePartUsageSchema.shape }),
      z.object({ operation: z.literal("officePart"), ...createOfficePartSchema.shape }),
      z.object({ operation: z.literal("officePartPlan"), ...createOfficePartSchema.shape }),
      updateSerializedUsageRepairOrderSchema,
      z.object({
        operation: z.literal("aggregateUsagePositions"),
        catalogPartId: id,
      }).strict(),
      z.object({
        operation: z.literal("aggregateUsageReserve"),
        catalogPartId: id,
        sourcePositionId: id,
        quantity: z.coerce.number().positive().max(999999.999).multipleOf(0.001),
        uomCode: z.string().trim().min(1).max(32),
        repairOrder: z.string().trim().max(2000).default(""),
        idempotencyKey: z.string().trim().min(8).max(160),
        pricing: z.object({
          selection: z.enum(["batch_cost", "internal_cost", "selling_price"]),
          expectedFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
          reason: z.string().trim().min(2).max(500),
        }).strict().optional(),
      }),
      z.object({
        operation: z.literal("aggregateUsageLifecycle"),
        usageId: id,
        action: z.enum(["install", "release", "reverse", "adjust"]),
        targetQuantity: z.coerce.number().positive().max(999999.999).multipleOf(0.001).optional(),
        reason: z.string().trim().min(2).max(500),
        idempotencyKey: z.string().trim().min(8).max(160),
      }),
      z.object({
        operation: z.literal("partPricingPreview"),
        usageKind: z.enum(["serialized", "aggregate", "no_stock"]),
        catalogPartId: id.optional(),
        usageId: id.optional(),
        noStockLineId: id.optional(),
        serializedUnitIds: z.array(id).min(1).max(100).optional(),
        sourcePositionId: id.optional(),
        quantity: z.coerce.number().positive().max(999999.999).multipleOf(0.001).optional(),
        uomCode: z.string().trim().min(1).max(32).optional(),
      }).strict().superRefine((value, ctx) => {
        const saved = value.usageId || value.noStockLineId;
        const serialized = value.usageKind === "serialized" && value.catalogPartId && value.serializedUnitIds?.length;
        const aggregate = value.usageKind === "aggregate" && value.catalogPartId && value.sourcePositionId
          && value.quantity !== undefined && value.uomCode;
        if (!saved && !serialized && !aggregate) ctx.addIssue({ code: "custom", message: "Choose a saved row or exact physical stock for pricing." });
      }),
      z.object({
        operation: z.literal("partPriceSelection"),
        customUnitPrice,
        usageKind: z.enum(["serialized", "aggregate", "no_stock"]),
        usageId: id.optional(),
        noStockLineId: id.optional(),
        selection: z.enum(["batch_cost", "internal_cost", "selling_price"]),
        reason: z.string().trim().min(2).max(500),
        idempotencyKey: z.string().trim().min(8).max(160),
        expectedFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    ]),
    approve: partDecision,
    decline: partDecision,
    allocate: z.object({ requestId: id, allocationId: id, ...updatePartAllocationSchema.shape }),
  }),
  chat: Object.freeze({
    send: sendMessageSchema,
    attach: sendMessageSchema,
    acknowledge: acknowledgeChatReceiptsSchema,
  }),
  completion: Object.freeze({
    markWorkDone: markDoneSchema,
    close: closeWorkorderSchema,
    cancel: cancelWorkorderSchema,
    requestChanges: returnWorkorderSchema,
  }),
  odoo: Object.freeze({
    prepare: prepareOdooWorkorderSchema,
    mapPart: mapOdooWorkorderPartSchema,
    createDraft: createOdooDraftSchema,
    markMissingInfo: z.object({ note: z.string().trim().min(1).max(1000) }).strict(),
  }),
});

export function modulePatchSchema(moduleKey) {
  return PATCH_SCHEMAS[moduleKey] || null;
}

export function moduleActionSchema(moduleKey, action) {
  return ACTIONS[moduleKey]?.[action] || null;
}

export function runtimeModuleRegistry() {
  return {
    patchModules: Object.keys(PATCH_SCHEMAS),
    actions: Object.fromEntries(Object.entries(ACTIONS).map(([key, actions]) => [key, Object.keys(actions)])),
  };
}
