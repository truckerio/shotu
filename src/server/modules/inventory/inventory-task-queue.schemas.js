import { z } from 'zod';

const uuid = z.string().uuid();
export const inventoryTaskSourceTypeSchema = z.enum([
  'damage_inspection','receipt_exception','missing_invoice','invoice_po_decision',
  'no_po_approval','transfer_receipt','position_recount','position_count_review','removed_part_custody',
]);

export const inventoryTaskQueueQuerySchema = z.object({
  locationId: uuid.optional(),
  view: z.enum(['my_work','all']).default('my_work'),
  sourceType: inventoryTaskSourceTypeSchema.optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().positive().max(100000).default(1),
}).strict();

const assignmentBase = {
  locationId: uuid,
  sourceType: inventoryTaskSourceTypeSchema,
  sourceId: uuid,
  sourceVersion: z.string().trim().min(1).max(80),
  expectedAssignmentVersion: z.number().int().min(0),
  idempotencyKey: z.string().trim().min(8).max(160),
  reason: z.string().trim().min(1).max(500),
};

export const inventoryTaskAssignmentCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...assignmentBase, action: z.literal('claim') }).strict(),
  z.object({ ...assignmentBase, action: z.literal('assign'), assignedUserId: uuid }).strict(),
  z.object({ ...assignmentBase, action: z.literal('unassign') }).strict(),
]);
