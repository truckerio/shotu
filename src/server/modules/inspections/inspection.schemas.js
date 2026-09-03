import { z } from "zod";
import { DATABASE_UUID_PATTERN } from "../../db/company.js";

export const createInspectionSchema = z.object({
  companyId: z.string().regex(DATABASE_UUID_PATTERN), locationId: z.string().uuid(), assetId: z.string().uuid(),
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

export const inspectionVersionActionSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
export const cancelInspectionSchema = z.object({ expectedVersion: z.number().int().positive(), reason: z.string().trim().min(2).max(1000) }).strict();
export const completeInspectionSchema = z.object({ expectedVersion: z.number().int().positive(), finalNotes: z.string().trim().max(5000).default("") }).strict();
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

export const createInspectionRevisionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(2).max(1000),
  mechanicUserIds: z.array(z.string().uuid()).max(10).transform((ids) => [...new Set(ids)]).default([]),
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict();

export const createInspectionPrintArchiveSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict();

export const inspectionListSchema = z.object({
  status: z.enum(["requested", "assigned", "in_progress", "completed", "cancelled", "needs_action"]).optional(),
  unitType: z.enum(["Truck", "Trailer"]).optional(),
  result: z.enum(["passed", "issues_found", "out_of_service"]).optional(),
  locationId: z.string().uuid().optional(), mechanicId: z.string().uuid().optional(),
  search: z.string().trim().max(120).default(""), cursor: z.string().max(1000).nullable().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict();
