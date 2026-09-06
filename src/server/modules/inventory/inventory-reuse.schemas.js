import { z } from "zod";
import { DATABASE_UUID_PATTERN } from "../../db/company.js";

export const reuseId = z.string().uuid();
export const reuseKey = z.string().trim().min(8).max(120);
const evidence = z.string().trim().min(1).max(2000);
const route = z.enum(["inspect_for_reuse", "repair", "core_return", "scrap", "not_sure"]);
const condition = z.enum(["new", "serviceable_used", "refurbished", "needs_repair", "unserviceable", "unknown"]);
const unitState = z.enum(["available", "in_stock", "reserved", "issued", "installed_pending_approval", "installed", "removed", "returned", "scrapped"]);
const scope = { companyId: z.string().regex(DATABASE_UUID_PATTERN), locationId: reuseId };
const command = { ...scope, expectedVersion: z.number().int().positive().optional(), idempotencyKey: reuseKey };
export const reuseScopeSchema = z.object(scope).strict();
export const reuseConfigReadSchema = z.object({ ...scope, catalogPartId: reuseId.optional() }).strict();
export const reuseRemoveSchema = z.object({
  ...command, usageId: reuseId, removalWorkorderId: reuseId.optional(), reason: evidence,
  ownership: z.enum(["company", "customer", "unknown"]).optional(), ownershipEvidence: z.string().trim().max(2000).default(""),
  intendedRoute: route.default("not_sure"), note: z.string().trim().max(2000).default(""),
}).strict().refine((v) => v.ownership !== "company" || v.ownershipEvidence.length > 0, { message: "Company ownership requires documented evidence.", path: ["ownershipEvidence"] });
export const reuseReceiveSchema = z.object({ ...command, evidence,
  exactUnitId: reuseId.optional(),
  actualHolderType: z.enum(["inventory_location", "handoff", "internal_repair", "external_repair", "core_vendor", "scrap_area", "unknown"]).default("inventory_location"),
  actualLocationId: reuseId.optional(), binLocation: z.string().trim().max(200).default(""), correctedRoute: route.optional(),
}).strict();
export const reuseReviewSchema = z.object({ ...command, decision: z.enum(["release", "hold"]), inspectionEvidence: evidence, reason: evidence, binLocation: z.string().trim().max(200).default("") }).strict();
export const reuseRouteSchema = z.object({ ...command, route, evidence }).strict();
export const reuseRepairStartSchema = z.object({ ...command, handlerType: z.enum(["internal", "external"]), handlerReference: evidence, evidence }).strict();
export const reuseRepairCompleteSchema = z.object({ ...command, evidence, exactUnitId: reuseId, receiptEvidence: evidence, binLocation: z.string().trim().max(200).default(""), release: z.boolean().default(false), inspectionEvidence: z.string().trim().max(2000).default("") }).strict();
export const reuseDispositionSchema = z.object({ ...command, evidence, externalReference: z.string().trim().min(1).max(500), dispositionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { const parsed = new Date(`${value}T00:00:00Z`); return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }, "Invalid disposition date") }).strict();
export const reuseQuarantineSchema = z.object({ ...command, resolution: z.enum(["inspect_for_reuse", "repair", "core_return", "scrap"]), evidence }).strict();
export const reuseCorrectionSchema = z.object({ ...command, unitId: reuseId, custodyVersion: z.number().int().positive(), holderType: z.enum(["inventory_location","handoff","internal_repair","external_repair","core_vendor","scrap_area","unknown"]), binLocation: z.string().trim().max(200).default(""), externalReference: z.string().trim().max(500).default(""), evidence }).strict();
export const reuseLegacyTrackSchema = z.object({ ...command, assetId: reuseId, catalogPartId: reuseId, removalWorkorderId: reuseId.optional(), serialNumber: z.string().trim().max(200).optional(), reason: evidence, ownership: z.enum(["company","customer","unknown"]), ownershipEvidence: z.string().trim().max(2000).default(""), intendedRoute: route.default("not_sure"), note: z.string().trim().max(2000).default("") }).strict();
export const reuseReadSchema = z.object({ ...scope, limit: z.coerce.number().int().min(1).max(100).default(50), cursor: reuseId.optional(), q: z.string().trim().max(200).default(""), status: z.string().trim().max(80).optional(), unitState: unitState.optional(), route: route.optional(), condition: condition.optional(), catalogPartId: reuseId.optional(), code: z.string().trim().max(4000).optional() }).strict();
export const reuseGrantSchema = z.object({ ...scope, userId: reuseId, capabilities: z.array(z.enum(["remove", "receive", "release", "route", "repair", "disposition", "quarantine"])).max(7), reason: evidence }).strict();
export const reusePolicySchema = z.object({ ...scope, catalogPartId: reuseId, reuseAllowed: z.boolean(), repairAllowed: z.boolean().default(false), coreReturnAllowed: z.boolean().default(false), scrapAllowed: z.boolean().default(true), evidence }).strict();
