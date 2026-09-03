import { z } from "zod";
import { DATABASE_UUID_PATTERN } from "../../db/company.js";

export const createInspectionSchema = z.object({
  companyId: z.string().regex(DATABASE_UUID_PATTERN), locationId: z.string().uuid(), assetId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(120),
  mechanicUserIds: z.array(z.string().uuid()).max(10).transform((ids) => [...new Set(ids)]).default([]),
  dueAt: z.string().datetime().nullable().optional(),
  officeInstructions: z.string().trim().max(4000).default(""),
}).strict();

const findingSchema = z.object({
  severity: z.enum(["attention", "repair_required", "out_of_service"]),
  note: z.string().trim().min(1).max(4000),
  disposition: z.enum(["new_workorder", "linked_workorder", "office_follow_up", "no_workorder"]),
  noWorkorderReason: z.string().trim().max(2000).default(""),
}).strict().superRefine((value, context) => {
  if (value.disposition === "no_workorder" && !value.noWorkorderReason) context.addIssue({ code: "custom", path: ["noWorkorderReason"], message: "Explain why no workorder is needed." });
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

export const inspectionListSchema = z.object({
  status: z.enum(["requested", "assigned", "in_progress", "completed", "cancelled", "needs_action", "not_completed"]).optional(),
  unitType: z.enum(["Truck", "Trailer"]).optional(),
  result: z.enum(["passed", "issues_found", "out_of_service"]).optional(),
  locationId: z.string().uuid().optional(), mechanicId: z.string().uuid().optional(),
  search: z.string().trim().max(120).default(""), cursor: z.string().max(1000).nullable().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict();

export const workorderInspectionContextParamsSchema=z.object({workorderId:z.string().uuid()}).strict();
