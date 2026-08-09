import { z } from "zod";
import { WORKORDER_ROLES } from "../../../../shared/workorder-modules.js";

export const moduleAccessScopeSchema = z.object({
  companyId: z.string().uuid(),
  locationId: z.string().uuid().optional().nullable(),
}).strict();

export const canonicalModuleRulePatchSchema = z.object({
  companyId: z.string().uuid(),
  locationId: z.string().uuid().optional().nullable(),
  surface: z.enum(["create", "detail"]),
  moduleKey: z.string().trim().min(1).max(80),
  access: z.enum(["inherit", "hidden", "read", "write"]),
  required: z.boolean().default(false),
  expectedVersion: z.number().int().nonnegative().optional(),
}).strict();

export const moduleAccessRoleSchema = z.enum(WORKORDER_ROLES);

