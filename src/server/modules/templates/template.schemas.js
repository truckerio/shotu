import { z } from "zod";
import { INSPECTION_RENDERER_VERSION, INSPECTION_ANNUAL_RENDERER_VERSION, INSPECTION_SCHEMA_VERSION } from "../../../../shared/inspection-template.js";
import { DATABASE_UUID_PATTERN } from "../../db/company.js";
const inspectionTypeSchema = z.enum(["weekly", "annual", "pre_trip", "post_trip", "custom"]);
const presetSchema = z.enum(["weekly-truck", "weekly-trailer", "annual-truck", "annual-trailer", "pre-trip-truck", "pre-trip-trailer", "post-trip-truck", "post-trip-trailer", "custom"]);
const companyIdSchema = z.string().regex(DATABASE_UUID_PATTERN, "Invalid company ID");

const checklistItem = z.object({
  key: z.string().trim().min(1).max(160),
  label: z.string().trim().min(1).max(500),
  required: z.boolean().default(true),
  allowNa: z.boolean().default(true),
  requireNaReason: z.boolean().default(false),
}).strict();

const section = z.object({
  key: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(300),
  items: z.array(checklistItem).min(1).max(100),
}).strict();

export const inspectionTemplateDefinitionSchema = z.object({
  familyKey: z.literal("inspection"),
  inspectionType: inspectionTypeSchema.default("weekly"),
  presetKey: presetSchema,
  label: z.string().trim().min(1).max(200),
  assetType: z.enum(["Truck", "Trailer"]),
  schemaVersion: z.literal(INSPECTION_SCHEMA_VERSION),
  rendererVersion: z.enum([INSPECTION_RENDERER_VERSION, INSPECTION_ANNUAL_RENDERER_VERSION]),
  printLayout: z.enum(["standard", "annual_report"]).optional(),
  sections: z.array(section).min(1).max(20),
}).strict().superRefine((definition, context) => {
  const expectedRenderer = definition.printLayout === "annual_report" ? INSPECTION_ANNUAL_RENDERER_VERSION : INSPECTION_RENDERER_VERSION;
  if (definition.rendererVersion !== expectedRenderer) context.addIssue({ code: "custom", path: ["rendererVersion"], message: "Renderer must match the selected print layout." });
  if (definition.presetKey !== "custom") {
    const expected = `${definition.inspectionType.replaceAll("_", "-")}-${definition.assetType.toLowerCase()}`;
    if (definition.presetKey !== expected) context.addIssue({ code: "custom", path: ["presetKey"], message: "Preset must match the inspection and unit types." });
  }
  const keys = definition.sections.flatMap((entry) => [entry.key, ...entry.items.map((item) => item.key)]);
  if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", path: ["sections"], message: "Section and item keys must be unique." });
  if (definition.sections.reduce((count, entry) => count + entry.items.length, 0) > 100) {
    context.addIssue({ code: "custom", path: ["sections"], message: "A template can contain at most 100 checks." });
  }
});

export const createTemplateSchema = z.object({
  inspectionType: inspectionTypeSchema.optional(),
  companyId: companyIdSchema,
  name: z.string().trim().min(1).max(200),
  applicabilityKey: z.enum(["Truck", "Trailer"]),
  presetKey: presetSchema,
  definition: inspectionTemplateDefinitionSchema,
}).strict().superRefine((value, context) => {
  if (value.inspectionType && value.inspectionType !== value.definition.inspectionType) context.addIssue({ code: "custom", path: ["inspectionType"], message: "Template inspection type must match its definition." });
  if (value.applicabilityKey !== value.definition.assetType) context.addIssue({ code: "custom", path: ["definition", "assetType"], message: "Template unit type must match its applicability." });
  if (value.presetKey !== value.definition.presetKey) context.addIssue({ code: "custom", path: ["definition", "presetKey"], message: "Template preset must match its definition." });
  if ((value.presetKey === "weekly-truck" && value.applicabilityKey !== "Truck") || (value.presetKey === "weekly-trailer" && value.applicabilityKey !== "Trailer")) context.addIssue({ code: "custom", path: ["presetKey"], message: "Weekly preset must match the unit type." });
});

export const updateTemplateDraftSchema = z.object({
  definition: inspectionTemplateDefinitionSchema,
  expectedVersion: z.number().int().positive(),
}).strict();

export const createTemplateRevisionSchema = z.object({
  companyId: companyIdSchema,
  expectedVersion: z.number().int().positive(),
}).strict();

export const archiveInspectionTemplateSchema=z.object({
  companyId:companyIdSchema,
  expectedVersion:z.number().int().positive(),
  idempotencyKey:z.string().trim().min(8).max(120),
  replacements:z.array(z.object({assignmentId:z.string().uuid(),expectedVersion:z.number().int().positive(),replacementVersionId:z.string().uuid()}).strict()).max(100).refine((entries)=>new Set(entries.map((entry)=>entry.assignmentId)).size===entries.length,{message:"Each assignment may be replaced only once."}),
}).strict();

export const assignTemplateSchema = z.object({
  companyId: companyIdSchema,
  locationId: z.string().uuid().nullable().optional(),
  familyKey: z.literal("inspection"),
  inspectionType: inspectionTypeSchema.default("weekly"),
  applicabilityKey: z.enum(["Truck", "Trailer"]),
  templateVersionId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
}).strict();

export const publishInspectionTemplateSchema = z.object({
  companyId: companyIdSchema,
  expectedVersion: z.number().int().positive(),
  definition: inspectionTemplateDefinitionSchema,
  assignment: assignTemplateSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.assignment && value.assignment.inspectionType !== value.definition.inspectionType) context.addIssue({ code: "custom", path: ["assignment", "inspectionType"], message: "Assignment inspection type must match its definition." });
  if (value.assignment && value.assignment.applicabilityKey !== value.definition.assetType) {
    context.addIssue({ code: "custom", path: ["assignment", "applicabilityKey"], message: "Template assignment unit type must match its definition." });
  }
});
