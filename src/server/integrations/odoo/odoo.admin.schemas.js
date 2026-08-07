import { z } from "zod";

export const odooConfigurationSchema = z.object({
  baseUrl: z.string().trim().url().max(500),
  database: z.string().trim().min(1).max(200),
  username: z.string().trim().min(1).max(320),
  apiKey: z.string().trim().min(8).max(1000),
}).strict();

export const odooLocationMappingSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("mapped"), locationId: z.string().uuid() }).strict(),
  z.object({ status: z.literal("unmatched") }).strict(),
  z.object({ status: z.literal("ignored") }).strict(),
]);

const odooExternalIdSchema = z.string().trim().regex(/^\d+$/, "Select a valid Odoo record.").max(120);
export const odooOutboundInternalIdSchema = z.string().uuid("Select a valid application record.");

export const odooOutboundVehicleMappingSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("mapped"), externalId: odooExternalIdSchema }).strict(),
  z.object({ status: z.literal("unmatched") }).strict(),
  z.object({ status: z.literal("ignored") }).strict(),
]);

export const odooOutboundWarehouseMappingSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("mapped"), externalId: odooExternalIdSchema }).strict(),
  z.object({ status: z.literal("unmatched") }).strict(),
]);

export const odooOutboundLaborProductSchema = z.object({
  productExternalId: odooExternalIdSchema,
}).strict();

export const odooOutboundVehicleListSchema = z.object({
  status: z.enum(["all", "mapped", "unmatched", "ignored"]).default("all"),
  q: z.string().trim().max(200).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.coerce.number().int().nonnegative().default(0),
});

export const odooOutboundProviderVehicleListSchema = z.object({
  q: z.string().trim().max(200).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
