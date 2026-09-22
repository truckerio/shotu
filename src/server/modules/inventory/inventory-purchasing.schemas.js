import { z } from "zod";
const id = z.string().uuid();
const money = z.string().regex(/^\d{1,10}(\.\d{1,4})?$/, "Enter a nonnegative price with up to four decimal places.").nullable();
const demandSource = z.object({
  sourceType:z.enum(["workorder_request","stocking_policy","legacy_request"]),
  sourceId:id,
  plannedQuantity:z.number().positive().max(999999.999),
}).strict();
const purchaseLine = z.object({ catalogPartId: id.optional(), partNumber:z.string().trim().min(1).max(200).optional(), description:z.string().trim().min(1).max(1000).optional(), uomCode:z.string().optional(), trackingMode:z.enum(["quantity","serialized","measured_bulk"]).optional(), quantity: z.number().positive().max(999999.999), unitPrice: money.default(null), demandSources:z.array(demandSource).max(500).default([]) }).strict().superRefine((line,context)=>{
  const keys=line.demandSources.map(source=>`${source.sourceType}:${source.sourceId}`);
  if(new Set(keys).size!==keys.length)context.addIssue({code:'custom',path:['demandSources'],message:'Each demand source can be linked only once per purchase line.'});
  const planned=line.demandSources.reduce((sum,source)=>sum+source.plannedQuantity,0);
  if(line.demandSources.length&&Math.abs(planned-line.quantity)>0.0005)context.addIssue({code:'custom',path:['demandSources'],message:'Demand sources must explain the full purchase quantity.'});
});
export const purchaseScopeSchema = z.object({ locationId: id, supplierId: z.union([id,z.literal('')]).default(''), query: z.string().trim().max(200).default(''), page: z.coerce.number().int().min(1).max(100000).default(1),view:z.enum(['purchases','receiving']).default('purchases'),status:z.enum(['all','draft','awaiting_approval','ordered','partially_received','received','closed_with_discrepancy','cancelled']).default('all') }).strict();
export const purchaseCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("supplier"), locationId: id, idempotencyKey: id, name: z.string().trim().min(1).max(240), contact: z.string().trim().max(500).default("") }).strict(),
  z.object({ action: z.enum(["create","revise"]), orderId:id.optional(), expectedVersion:z.number().int().positive().optional(), locationId: id, idempotencyKey: id, supplierId: id, currency: z.string().regex(/^[A-Z]{3}$/), notes: z.string().trim().max(2000).default(""), expectedDeliveryDate: z.iso.date().nullable().default(null), placeOrder: z.boolean().default(false),
    lines: z.array(purchaseLine).min(1).max(100),
  }).strict(),
  z.object({ action: z.enum(["submit","approve","cancel","place","record_sent","receive"]), locationId: id, idempotencyKey: id, orderId: id, expectedVersion: z.number().int().positive(), confirmation: z.literal("all_ordered_goods_received").optional(), deliveryCondition: z.enum(["undamaged","damaged"]).optional(), damageDetails: z.string().trim().max(500).default(""), reason: z.string().trim().max(2000).default("") }).strict(),
]);

export const purchaseApprovalScopeSchema = z.object({ locationId: id }).strict();
const purchaseReceiptLineSchema = z.object({
  purchaseLineId: id,
  targetPositionId: id.optional(),
  acceptedQuantity: z.number().min(0).max(999999.999).default(0),
  heldQuantity: z.number().min(0).max(999999.999).default(0),
  rejectedQuantity: z.number().min(0).max(999999.999).default(0),
  notReceivedQuantity: z.number().min(0).max(999999.999).default(0),
  outcome: z.enum(["accepted", "damaged", "wrong", "short", "over"]),
  notes: z.string().trim().max(500).default(""),
  holdLocation: z.string().trim().max(240).default(""),
  serialNumbers: z.array(z.string().trim().min(1).max(100)).max(500).default([]),
}).strict().superRefine((value, context) => {
  if (value.targetPositionId && value.acceptedQuantity <= 0) context.addIssue({ code: "custom", path: ["targetPositionId"], message: "Choose a destination only for accepted stock." });
  const actual = value.acceptedQuantity + value.heldQuantity + value.rejectedQuantity;
  if (actual <= 0 && value.notReceivedQuantity <= 0) context.addIssue({ code: "custom", path: ["acceptedQuantity"], message: "Record a received or not received quantity." });
  if (value.outcome === "accepted" && actual !== value.acceptedQuantity) context.addIssue({ code: "custom", path: ["outcome"], message: "Choose the exception for non-accepted stock." });
  if (["damaged", "wrong"].includes(value.outcome) && value.heldQuantity + value.rejectedQuantity <= 0) context.addIssue({ code: "custom", path: ["heldQuantity"], message: "Record held or rejected stock." });
  if (value.outcome === "wrong" && value.acceptedQuantity > 0) context.addIssue({ code: "custom", path: ["acceptedQuantity"], message: "A wrong item cannot be accepted as the ordered part." });
  if (value.outcome === "short" && (value.notReceivedQuantity <= 0 || value.heldQuantity > 0 || value.rejectedQuantity > 0)) context.addIssue({ code: "custom", path: ["notReceivedQuantity"], message: "Record shortage separately from damaged or rejected stock." });
  if (value.outcome !== "accepted" && !value.notes) context.addIssue({ code: "custom", path: ["notes"], message: "Record a short exception note." });
});

export const purchaseReceiptSchema = z.object({
  locationId: id,
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(120),
  reference: z.string().trim().max(240).default(""),
  lines: z.array(purchaseReceiptLineSchema).min(1).max(100),
}).strict().superRefine((value, context) => {
  if (new Set(value.lines.map((line) => line.purchaseLineId)).size !== value.lines.length) context.addIssue({ code: "custom", path: ["lines"], message: "Each purchase line can appear only once per delivery." });
});

export const purchaseApprovalSettingsSchema = z.object({
  locationId: id, expectedVersion: z.number().int().nonnegative(),
  approvalLimit: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter a nonnegative approval limit with up to two decimal places.'),
  currency: z.string().regex(/^[A-Z]{3}$/),
  approverUserIds: z.array(id).max(500).transform(values => [...new Set(values)]),
  approverRoles: z.array(z.enum(['office','admin'])).max(2).transform(values => [...new Set(values)]),
}).strict();
