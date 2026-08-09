import { z } from "zod";
import { userRoleSchema } from "../../auth/roles.js";
import {
  WORKORDER_ACCESS_MODES,
  WORKORDER_MODULES,
  WORKORDER_ROLES,
  WORKORDER_SURFACES,
} from "../../../../shared/workorder-modules.js";
import {
  issueKioskPinSchema,
  registerKioskDeviceSchema,
} from "../kiosk/kiosk.schemas.js";

export const createLocationSchema = z.object({
  companyId: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120),
  type: z.string().trim().min(2).max(50).default("yard"),
  address: z.string().trim().max(500).default(""),
});

export const updateLocationSchema = createLocationSchema.partial().extend({
  active: z.boolean().optional(),
});

export const updateLocationTemplateSchema = z.object({
  headerTitle: z.string().trim().min(2).max(160),
  brandTop: z.string().trim().min(1).max(80),
  brandBottom: z.string().trim().min(1).max(80),
  warrantyText: z.string().trim().max(500),
  responsibilityText: z.string().trim().max(2000),
  authorizationText: z.string().trim().max(4000),
});

const workorderAccessModeSchema = z.enum(Object.values(WORKORDER_ACCESS_MODES));

function moduleSurfaceAccessSchema(surface) {
  return z.object(Object.fromEntries(
    WORKORDER_MODULES
      .filter((module) => module.surfaces.includes(surface))
      .map((module) => [module.key, workorderAccessModeSchema.optional()]),
  )).strict();
}

const workorderModuleAccessSchema = z.object(
  Object.fromEntries(WORKORDER_ROLES.map((role) => [
    role,
    z.object(
      Object.fromEntries(Object.values(WORKORDER_SURFACES).map((surface) => [
        surface,
        moduleSurfaceAccessSchema(surface).optional(),
      ])),
    ).partial().strict().optional(),
  ])),
).partial().strict();

const userWorkorderModuleAccessSchema = z.record(
  z.string().uuid(),
  z.object(
    Object.fromEntries(Object.values(WORKORDER_SURFACES).map((surface) => [
      surface,
      moduleSurfaceAccessSchema(surface).optional(),
    ])),
  ).partial().strict(),
).optional();

export const updateCompanyWorkorderModulePolicySchema = z.object({
  moduleAccess: workorderModuleAccessSchema,
  userModuleAccess: userWorkorderModuleAccessSchema.default({}),
  expectedVersion: z.number().int().nonnegative().optional(),
}).strict();

export const updateLocationWorkorderPolicySchema = z.object({
  mechanicCanRecordParts: z.boolean(),
  moduleAccess: workorderModuleAccessSchema.optional(),
  userModuleAccess: userWorkorderModuleAccessSchema,
  expectedVersion: z.number().int().nonnegative().optional(),
}).strict();

export const createInvitationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(320),
  role: userRoleSchema,
  locationIds: z.array(z.string().uuid()).min(1).max(100).optional(),
});

export const updateManagedUserLocationsSchema = z.object({
  companyId: z.string().uuid().optional(),
  locationIds: z.array(z.string().uuid()).max(100).transform((ids) => [...new Set(ids)]),
});

export const acceptInvitationSchema = z.object({
  username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9_.]+$/),
  password: z.string().min(12).max(128),
});

export const updateManagedUserStatusSchema = z.object({
  active: z.boolean(),
});

export const resetManagedUserPasswordSchema = z.object({
  password: z.string().min(12).max(128),
});

export const requestManagedUserPasswordResetSchema = z.object({
  companyId: z.string().uuid(),
});

export { issueKioskPinSchema, registerKioskDeviceSchema };
