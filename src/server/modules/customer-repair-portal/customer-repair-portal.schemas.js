import { z } from "zod";
import { DATABASE_UUID_PATTERN } from "../../db/company.js";
const companyId = z.string().regex(DATABASE_UUID_PATTERN);
const uuid = z.string().uuid();
export const repairScopeSchema = z
  .object({ companyId, locationId: uuid })
  .strict();
export const repairGrantSchema = repairScopeSchema
  .extend({
    expiresAt: z.string().datetime({ offset: true }),
    idempotencyKey: z.string().trim().min(8).max(120),
  })
  .strict();
export const repairEmailSchema = repairScopeSchema
  .extend({
    workorderId: uuid,
    rawToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    recipientEmail: z.string().trim().email().max(320),
    idempotencyKey: z.string().trim().min(8).max(120),
  })
  .strict();
export const repairRevokeSchema = repairScopeSchema
  .extend({ workorderId: uuid })
  .strict();
export const repairResponseSchema = z
  .object({
    revisionId: uuid,
    response: z.enum(["accepted", "declined", "changes_requested"]),
    customerName: z.string().trim().min(1).max(300),
    note: z.string().trim().max(5000).optional(),
    idempotencyKey: z.string().trim().min(8).max(120),
  })
  .strict();
export const repairChatSchema = z
  .object({
    body: z.string().trim().min(1).max(5000),
    customerName: z.string().trim().min(1).max(300),
    idempotencyKey: z.string().trim().min(8).max(120),
  })
  .strict();
export const repairStaffChatSchema = repairScopeSchema
  .extend({
    body: z.string().trim().min(1).max(5000),
    idempotencyKey: z.string().trim().min(8).max(120),
  })
  .strict();
