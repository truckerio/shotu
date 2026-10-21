import { z } from "zod";
import { DATABASE_UUID_PATTERN } from "../../db/company.js";
import { canonicalizeInspectionDeferral } from "../../../../shared/inspection-maintenance.js";

export const createInspectionSchema = z.object({
  customerAccountId: z.string().uuid().optional(),
  customerCompanyName: z.string().trim().max(300).optional(),
  customerAddress: z.string().trim().max(1000).optional(),
  inspectionType: z.enum(["weekly", "annual", "pre_trip", "post_trip", "custom"]).default("weekly"),
  companyId: z.string().regex(DATABASE_UUID_PATTERN), locationId: z.string().uuid(), assetId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(120),
  mechanicUserIds: z.array(z.string().uuid()).max(10).transform((ids) => [...new Set(ids)]).default([]),
  dueAt: z.string().datetime().nullable().optional(),
  officeInstructions: z.string().trim().max(4000).default(""),
}).strict();

export const inspectionDeferralSchema = z.object({
  reason: z.string().trim().min(2).max(2000),
  nextVisit: z.boolean().default(false),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  dueMiles: z.number().finite().min(0).max(99_999_999.9).nullable().default(null),
  baselineMiles: z.number().finite().min(0).max(99_999_999.9).nullable().default(null),
  additionalMiles: z.number().finite().positive().max(99_999_999.9).nullable().default(null),
  earlyMiles: z.number().finite().min(0).max(10_000).default(200),
}).strict().superRefine((value, context) => {
  if (!value.nextVisit && !value.dueDate && value.dueMiles == null && value.additionalMiles == null) context.addIssue({ code:"custom", path:["nextVisit"], message:"Choose next shop visit, a date, or a mileage target." });
  if (value.additionalMiles != null && value.baselineMiles == null) context.addIssue({ code:"custom", path:["baselineMiles"], message:"Confirm current mileage before using additional miles." });
  try { canonicalizeInspectionDeferral(value); }
  catch (error) { context.addIssue({ code:"custom", message:error?.message || "Invalid deferral policy." }); }
});

const findingSchema = z.object({
  severity: z.enum(["attention", "repair_required", "out_of_service"]),
  note: z.string().trim().min(1).max(4000),
  disposition: z.enum(["new_workorder", "linked_workorder", "office_follow_up", "no_workorder", "defer"]),
  noWorkorderReason: z.string().trim().max(2000).default(""),
  deferral: inspectionDeferralSchema.nullable().default(null),
}).strict().superRefine((value, context) => {
  if (value.disposition === "no_workorder" && !value.noWorkorderReason) context.addIssue({ code: "custom", path: ["noWorkorderReason"], message: "Explain why no workorder is needed." });
  if (value.disposition === "defer" && value.severity !== "attention") context.addIssue({ code:"custom", path:["severity"], message:"Only an Attention issue can be deferred." });
  if (value.disposition === "defer" && !value.deferral) context.addIssue({ code:"custom", path:["deferral"], message:"Deferral reason and review trigger are required." });
  if (value.disposition !== "defer" && value.deferral) context.addIssue({ code:"custom", path:["deferral"], message:"Only a deferred issue can have a deferral policy." });
});

export const saveInspectionResponsesSchema = z.object({
  expectedVersion: z.number().int().positive(),
  responses: z.array(z.object({
    itemKey: z.string().trim().min(1).max(160),
    response: z.enum(["pass", "issue", "na"]),
    naReason: z.string().trim().max(1000).default(""),
    finding: findingSchema.nullable().optional(),
  }).strict().superRefine((value, context) => {
    if (value.response === "issue" && !value.finding) context.addIssue({ code: "custom", path: ["finding"], message: "Issue severity, note, and disposition are required." });
    if (value.response !== "issue" && value.finding) context.addIssue({ code: "custom", path: ["finding"], message: "Only an Issue can have a finding." });
  })).min(1).max(100),
}).strict();

export const inspectionVersionActionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  odometerMiles: z.number().finite().min(0).max(99_999_999.9).optional(),
  engineHours: z.number().finite().min(0).max(9_999_999.9).optional(),
  previousReportReviewed: z.boolean(),
}).strict();
export const claimInspectionSchema = z.object({
  expectedVersion: z.number().int().positive(),
}).strict();
export const cancelInspectionSchema = z.object({ expectedVersion: z.number().int().positive(), reason: z.string().trim().min(2).max(1000) }).strict();
export const completeInspectionSchema = z.object({ expectedVersion: z.number().int().positive(), finalNotes: z.string().trim().max(5000).default(""), actingAsInspector: z.literal(true).optional() }).strict();
export const assignInspectionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  mechanicUserIds: z.array(z.string().uuid()).max(10).transform((ids) => [...new Set(ids)]),
}).strict();

export const linkInspectionWorkorderSchema = z.object({
  expectedVersion: z.number().int().positive(),
  workorderId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict();

export const createInspectionWorkorderSchema = z.object({
  expectedVersion: z.number().int().positive(),
  findingIds: z.array(z.string().uuid()).min(1).max(25).transform((ids) => [...new Set(ids)]),
  idempotencyKey: z.string().trim().min(8).max(120),
  concern: z.string().trim().min(1).max(5000).optional(),
  officeNotes: z.string().trim().max(5000).optional(),
}).strict();

const correctionResponseSchema=z.object({itemKey:z.string().trim().min(1).max(160),response:z.enum(["pass","issue","na"]),naReason:z.string().trim().max(1000).default(""),finding:findingSchema.nullable().optional()}).strict().superRefine((value,context)=>{if(value.response==="issue"&&!value.finding)context.addIssue({code:"custom",path:["finding"],message:"Issue severity, note, and disposition are required."});if(value.response!=="issue"&&value.finding)context.addIssue({code:"custom",path:["finding"],message:"Only an Issue can have a finding."});});
export const createInspectionCorrectionSchema=z.object({expectedVersion:z.number().int().positive(),reason:z.string().trim().min(2).max(1000),idempotencyKey:z.string().trim().min(8).max(120),changes:z.object({finalNotes:z.string().trim().max(5000).optional(),responses:z.array(correctionResponseSchema).min(1).max(100).refine((entries)=>new Set(entries.map((entry)=>entry.itemKey)).size===entries.length,{message:"Each corrected checklist item may appear only once."}).optional()}).strict().refine((value)=>value.finalNotes!==undefined||value.responses!==undefined,{message:"Supply at least one corrected field."})}).strict();
export const createInspectionReinspectionSchema=z.object({expectedVersion:z.number().int().positive(),reason:z.string().trim().min(2).max(1000),mechanicUserIds:z.array(z.string().uuid()).max(10).transform((ids)=>[...new Set(ids)]).default([]),startImmediately:z.literal(false).default(false),idempotencyKey:z.string().trim().min(8).max(120)}).strict();

export const createInspectionPrintArchiveSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict();

const followUpCommandBase = {
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(120),
};
export const linkInspectionFollowUpSchema = z.object({
  ...followUpCommandBase,
  workorderId: z.string().uuid(),
}).strict();
export const createInspectionFollowUpWorkorderSchema = z.object({
  ...followUpCommandBase,
  concern: z.string().trim().min(1).max(5000).optional(),
  officeNotes: z.string().trim().max(5000).optional(),
}).strict();
export const resolveInspectionFollowUpNoWorkorderSchema = z.object({
  ...followUpCommandBase,
  reason: z.string().trim().min(2).max(2000),
}).strict();
export const deferInspectionFollowUpSchema = z.object({
  ...followUpCommandBase,
  reason: z.string().trim().min(2).max(2000),
  deferral: inspectionDeferralSchema,
}).strict().superRefine((value, context) => {
  if (value.reason !== value.deferral.reason) context.addIssue({ code:"custom", path:["reason"], message:"Follow-up reason must match the deferral reason." });
});
export const verifyInspectionFollowUpSchema = z.object({
  ...followUpCommandBase,
  reason: z.string().trim().min(2).max(2000),
}).strict();

export const recordInspectionMileageSchema = z.object({
  expectedVersion: z.number().int().min(0),
  idempotencyKey: z.string().trim().min(8).max(120),
  miles: z.number().finite().min(0).max(10_000_000),
  observedAt: z.string().datetime(),
  reason: z.string().trim().min(3).max(1000),
}).strict();
export const acceptInspectionProviderMileageSchema = z.object({
  expectedVersion: z.number().int().min(0),
  idempotencyKey: z.string().trim().min(8).max(120),
  reason: z.string().trim().min(3).max(1000),
}).strict();

export const inspectionListSchema = z.object({
  sort: z.enum(["updated_desc", "updated_asc"]).default("updated_desc"),
  status: z.enum(["requested", "assigned", "in_progress", "completed", "cancelled", "needs_action", "not_completed"]).optional(),
  unitType: z.enum(["Truck", "Trailer"]).optional(),
  result: z.enum(["passed", "issues_found", "out_of_service"]).optional(),
  locationId: z.string().uuid().optional(), mechanicId: z.string().uuid().optional(),
  search: z.string().trim().max(120).default(""), cursor: z.string().max(1000).nullable().optional(),
  page: z.coerce.number().int().positive().max(Math.floor(Number.MAX_SAFE_INTEGER / 50)).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict().superRefine((value, context) => {
  if (value.page !== undefined && value.cursor !== undefined) {
    context.addIssue({ code: "custom", path: ["cursor"], message: "Use page or cursor, not both." });
  }
});

export const workorderInspectionContextParamsSchema=z.object({workorderId:z.string().uuid()}).strict();
