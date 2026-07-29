import { z } from "zod";

const COMMON_PINS = new Set([
  "0123",
  "1234",
  "2345",
  "3456",
  "4567",
  "5678",
  "6789",
  "9876",
  "8765",
  "7654",
  "6543",
  "5432",
  "4321",
  "2580",
  "1212",
  "1122",
  "012345",
  "123456",
  "234567",
  "345678",
  "456789",
  "987654",
  "876543",
  "765432",
  "654321",
  "543210",
  "123123",
  "121212",
  "112233",
]);

export function isStrongKioskPin(pin) {
  if (!/^\d{4,}$/.test(pin)) return false;
  if (/^(\d)\1{3,}$/.test(pin)) return false;
  return !COMMON_PINS.has(pin);
}

export const kioskPinSchema = z.string()
  .regex(/^\d{4,}$/, "PIN must contain at least four digits.")
  .refine(isStrongKioskPin, "Choose a less common PIN.");

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
