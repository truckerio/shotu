import { z } from "zod";

const uuid = z.string().uuid();
const idempotencyKey = z.string().trim().min(8).max(160);
const positionKind = z.enum(["warehouse","zone","aisle","rack","shelf","bin","room","area"]);
const positionUsage = z.enum(["unassigned","receiving","storage","quarantine","returns","repair_staging","dispatch"]);

export const createInventoryPositionSchema = z.object({
  parentId: uuid.nullable().optional().default(null),
  code: z.string().trim().min(1).max(80).regex(/[A-Za-z0-9]/),
  name: z.string().trim().min(1).max(160),
  kind: positionKind,
  usage: positionUsage.nullable().optional().default(null),
  canStore: z.boolean().optional().default(false),
  isPickable: z.boolean().optional().default(false),
  idempotencyKey,
}).strict().superRefine((value, context) => {
  if (value.canStore !== Boolean(value.usage)) context.addIssue({ code: "custom", path: ["usage"], message: "Stock-holding positions require a usage." });
  if (value.isPickable && (!value.canStore || !["unassigned","receiving","storage"].includes(value.usage))) context.addIssue({ code: "custom", path: ["isPickable"], message: "Only usable stock positions can be pickable." });
});

export const updateInventoryPositionSchema = z.object({
  expectedVersion: z.number().int().min(1),
  name: z.string().trim().min(1).max(160).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((value) => value.name !== undefined || value.isActive !== undefined, "No position change was supplied.");

const aggregateMove = z.object({
  fromPositionId: uuid,
  toPositionId: uuid,
  quantity: z.number().positive().max(999999999),
  expectedSourceVersion: z.number().int().min(1),
  expectedDestinationVersion: z.number().int().min(1).nullable().optional().default(null),
  idempotencyKey,
  reason: z.string().trim().min(2).max(500),
}).strict().refine((value)=>value.fromPositionId!==value.toPositionId,{path:["toPositionId"],message:"Destination must differ from source."});
const exactMove = z.object({
  fromPositionId: uuid,
  toPositionId: uuid,
  unitIds: z.array(uuid).min(1).max(500),
  unitVersions: z.record(uuid, z.number().int().min(1)).optional().default({}),
  idempotencyKey,
  reason: z.string().trim().min(2).max(500),
}).strict()
  .refine((value)=>value.fromPositionId!==value.toPositionId,{path:["toPositionId"],message:"Destination must differ from source."})
  .refine((value) => new Set(value.unitIds).size === value.unitIds.length, { path: ["unitIds"], message: "Exact units must be unique." });
export const moveInventoryPositionSchema = z.union([aggregateMove, exactMove]);

export const startPositionCountSchema = z.object({ positionId: uuid, idempotencyKey }).strict();
export const recordPositionCountSchema = z.object({
  expectedVersion: z.number().int().min(1),
  observedQuantity: z.number().min(0).max(999999999),
  idempotencyKey,
}).strict();
export const addPositionCountFoundPartSchema = z.object({
  catalogPartId: uuid,
  expectedPartVersion: z.number().int().min(1),
  observedQuantity: z.number().positive().max(999999999),
  expectedVersion: z.number().int().min(1),
  idempotencyKey,
}).strict();
export const recordPositionCountIdentitySchema = z.object({
  serialNumber: z.string().trim().min(1).max(100),
  inputMode: z.enum(["scanner","manual"]),
  expectedVersion: z.number().int().min(1),
  idempotencyKey,
}).strict();
export const submitPositionCountSchema = z.object({
  expectedVersion: z.number().int().min(1),
  idempotencyKey,
}).strict();
export const applyPositionCountSchema = z.object({
  expectedVersion: z.number().int().min(1),
  idempotencyKey,
}).strict();

export const inventoryPositionSchemas = { positionKind, positionUsage };
