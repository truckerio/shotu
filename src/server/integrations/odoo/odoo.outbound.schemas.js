import { z } from "zod";

const externalIdSchema = z.string()
  .trim()
  .regex(/^\d+$/, "Select a valid Odoo record.")
  .refine((value) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0;
  }, "Select a valid Odoo record.");

export const odooOutboundWorkorderIdSchema = z.string().uuid("Workorder ID must be a valid UUID.");

export const prepareOdooWorkorderSchema = z.object({
  laborHours: z.coerce.number()
    .positive("Labor hours must be greater than zero.")
    .max(9999, "Labor hours are outside the supported range.")
    .refine((value) => Math.round(value * 100) === value * 100, "Labor hours can have at most two decimal places."),
  customerExternalId: externalIdSchema.optional().nullable(),
}).strict();

export const createOdooDraftSchema = z.object({
  expectedUpdatedAt: z.string().datetime().optional(),
}).strict();

export const mapOdooWorkorderPartSchema = z.object({
  lineIndex: z.coerce.number().int().min(0).max(999),
  productExternalId: externalIdSchema,
}).strict();
