import { z } from "zod";

export const reuseId = z.string().uuid();
export const reuseKey = z.string().trim().min(8).max(120);
const evidence = z.string().trim().min(1).max(2000);
const scope = { companyId: reuseId, locationId: reuseId };
export const reuseScopeSchema = z.object(scope).strict();
export const reuseRemoveSchema = z.object({
  ...scope, usageId: reuseId, removalWorkorderId: reuseId, reason: evidence,
  ownership: z.enum(["company", "customer", "unknown"]),
  ownershipEvidence: z.string().trim().max(2000).default(""), idempotencyKey: reuseKey,
}).strict().refine((v) => v.ownership !== "company" || v.ownershipEvidence.length > 0, {
  message: "Company ownership requires documented evidence.", path: ["ownershipEvidence"],
});
export const reuseReceiveSchema = z.object({ ...scope, evidence, idempotencyKey: reuseKey }).strict();
export const reuseReviewSchema = z.object({
  ...scope, decision: z.enum(["release", "hold"]), inspectionEvidence: evidence, reason: evidence, idempotencyKey: reuseKey,
}).strict();
export const reuseGrantSchema = z.object({
  ...scope, userId: reuseId, capabilities: z.array(z.enum(["remove", "receive", "release"])).max(3), reason: evidence,
}).strict();
export const reusePolicySchema = z.object({ ...scope, catalogPartId: reuseId, reuseAllowed: z.boolean(), evidence }).strict();
