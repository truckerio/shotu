import { z } from "zod";
import { invalidRequest } from "../../auth/errors.js";

const MAX_DRAFT_PAYLOAD_BYTES = 256 * 1024;

const draftPayloadSchema = z.record(z.string(), z.unknown())
  .refine(
    (payload) => Buffer.byteLength(JSON.stringify(payload), "utf8") <= MAX_DRAFT_PAYLOAD_BYTES,
    "Draft payload must be 256 KB or less.",
  );

export const draftTypeSchema = z.literal("workorder");

export const listWorkorderDraftsQuerySchema = z.object({
  type: draftTypeSchema.default("workorder"),
});

export const createWorkorderDraftSchema = z.object({
  type: draftTypeSchema,
  locationId: z.string().uuid("Select a valid location.").nullable().optional(),
  payload: draftPayloadSchema.default({}),
}).strict();

export const updateWorkorderDraftSchema = z.object({
  version: z.number().int().positive(),
  locationId: z.string().uuid("Select a valid location.").nullable().optional(),
  payload: draftPayloadSchema.optional(),
}).strict().refine(
  (input) => input.locationId !== undefined || input.payload !== undefined,
  "Provide a location or payload to save.",
);

export const submitWorkorderDraftSchema = z.object({
  version: z.number().int().positive().optional(),
}).strict();

export const takeoverWorkorderDraftSchema = z.object({
  version: z.number().int().positive(),
}).strict();

export const workorderDraftIdSchema = z.string().uuid("Draft not found.");

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw invalidRequest(result.error.issues[0]?.message || "Invalid draft request.");
}

export function parseWorkorderDraftListQuery(searchParams) {
  return parse(listWorkorderDraftsQuerySchema, {
    type: searchParams.get("type") || undefined,
  });
}

export function parseCreateWorkorderDraft(input) {
  return parse(createWorkorderDraftSchema, input);
}

export function parseUpdateWorkorderDraft(input) {
  return parse(updateWorkorderDraftSchema, input);
}

export function parseSubmitWorkorderDraft(input) {
  return parse(submitWorkorderDraftSchema, input);
}

export function parseTakeoverWorkorderDraft(input) {
  return parse(takeoverWorkorderDraftSchema, input);
}

export function parseWorkorderDraftId(value) {
  return parse(workorderDraftIdSchema, value);
}
