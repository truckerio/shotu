import { z } from "zod";

export function isValidKioskPin(pin) {
  return /^\d{4,}$/.test(pin);
}

export const kioskPinSchema = z.string()
  .regex(/^\d{4,}$/, "PIN must contain at least four digits.");

export const kioskUnlockSchema = z.object({
  mechanicId: z.string().uuid(),
  pin: z.string().regex(/^\d{4,}$/),
  newPin: kioskPinSchema.optional(),
});

export const registerKioskDeviceSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const issueKioskPinSchema = z.object({
  pin: kioskPinSchema,
});

export const kioskEventSchema = z.object({
  type: z.enum(["lock", "switch"]),
});
