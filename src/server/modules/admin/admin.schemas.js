import { z } from "zod";

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

export const createInvitationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(320),
  role: z.enum(["mechanic", "office", "surveillance"]),
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
