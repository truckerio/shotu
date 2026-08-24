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
} from "./workorder.schemas.js";
import { mechanicProgressSchema } from "../mechanic/mechanic-progress.schemas.js";
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
  diagnosisRepair: mechanicProgressSchema,
});

const id = z.string().uuid();
const partDecision = decidePartRequestSchema.extend({ requestId: id });

const ACTIONS = Object.freeze({
  assignment: Object.freeze({
    accept: z.object({}).strict(),
    release: releaseWorkorderSchema,
    assign: assignMechanicsSchema,
    reassign: reassignWorkorderSchema,
  }),
  parts: Object.freeze({
    request: createPartRequestSchema,
    record: z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("usedParts"), ...updateMechanicUsedPartsSchema.shape }),
      z.object({ operation: z.literal("usage"), requestId: id, ...updatePartUsageSchema.shape }),
      z.object({ operation: z.literal("officePart"), ...createOfficePartSchema.shape }),
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
