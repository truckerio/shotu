import { z } from "zod";

export const EVALUATION_VERSION = "invoice-evaluation-v1";
export const EVALUATION_NORMALIZER_VERSION = "invoice-normalizer-v1";
export const SCALAR_FIELD_PATHS = Object.freeze([
  "documentType", "vendorName", "vendorAccount", "invoiceNumber", "invoiceDate", "purchaseOrderNumber",
  "currency", "subtotal", "tax", "shipping", "total",
]);
export const LINE_FIELD_PATHS = Object.freeze(["partNumber", "description", "quantity", "unitOfMeasure", "unitPrice", "lineTotal"]);
export const ALL_FIELD_PATHS = Object.freeze([...SCALAR_FIELD_PATHS, ...LINE_FIELD_PATHS]);

const nullablePrimitive = z.union([z.string(), z.number().finite(), z.null()]);
const draftField = z.object({ value: nullablePrimitive, confidence: z.number().finite().min(0).max(100).optional() }).passthrough();
const truthField = z.object({ applicable: z.boolean(), value: nullablePrimitive }).strict();

export const evaluationDraftSchema = z.object({
  ...Object.fromEntries(SCALAR_FIELD_PATHS.map((path) => [path, draftField])),
  lines: z.array(z.object({ id: z.string().min(1).optional(), ...Object.fromEntries(LINE_FIELD_PATHS.map((path) => [path, draftField])) }).passthrough()),
  warnings: z.array(z.string()).optional(),
}).passthrough();

export const truthDraftSchema = z.object({
  ...Object.fromEntries(SCALAR_FIELD_PATHS.map((path) => [path, truthField])),
  lines: z.array(z.object({ id: z.string().min(1), ...Object.fromEntries(LINE_FIELD_PATHS.map((path) => [path, truthField])) }).strict()),
}).strict();

export const corpusCaseSchema = z.object({
  caseId: z.string().min(1), lineageGroupId: z.string().min(1), partition: z.enum(["train", "development", "shadow", "holdout"]),
  family: z.string().min(1), slices: z.array(z.string().min(1)).min(1),
  source: z.object({ modality: z.string().min(1), synthetic: z.boolean(), seedPartition: z.string().optional() }).strict(),
  labels: z.object({ status: z.enum(["resolved", "unresolved"]), guideVersion: z.string().min(1), truthDraft: truthDraftSchema }).strict(),
  artifactManifest: z.object({ capabilityRegistryHash: z.string().min(1), normalizerVersion: z.string().min(1) }).strict(),
}).strict();

export const predictionCaseSchema = z.object({
  caseId: z.string().min(1), draft: evaluationDraftSchema,
  decision: z.object({ outcome: z.enum(["accepted_draft", "needs_review", "unsupported", "rejected"]), accepted: z.boolean(), reviewReason: z.string().optional() }).strict(),
  artifactManifest: z.object({ capabilityRegistryHash: z.string().min(1), normalizerVersion: z.string().min(1) }).strict(),
}).strict().superRefine((value, context) => {
  if (value.decision.accepted !== (value.decision.outcome === "accepted_draft")) {
    context.addIssue({ code: "custom", path: ["decision", "accepted"], message: "accepted must exactly match accepted_draft outcome." });
  }
});

export function validateCorpus({ corpus, registryHash, normalizerVersion = EVALUATION_NORMALIZER_VERSION }) {
  const caseIds = new Set(); const partitions = new Map(); const lineageCases = new Set(); const failures = [];
  for (const input of corpus) {
    const item = corpusCaseSchema.parse(input);
    if (caseIds.has(item.caseId)) failures.push(`duplicate caseId: ${item.caseId}`); else caseIds.add(item.caseId);
    if (item.labels.status !== "resolved") failures.push(`unresolved labels: ${item.caseId}`);
    if (item.artifactManifest.capabilityRegistryHash !== registryHash) failures.push(`registry mismatch: ${item.caseId}`);
    if (normalizerVersion !== EVALUATION_NORMALIZER_VERSION || item.artifactManifest.normalizerVersion !== EVALUATION_NORMALIZER_VERSION) failures.push(`normalizer mismatch: ${item.caseId}`);
    if (item.source.synthetic && item.source.seedPartition === "holdout") failures.push(`holdout-seeded synthetic: ${item.caseId}`);
    const partition = partitions.get(item.lineageGroupId);
    if (partition && partition !== item.partition) failures.push(`lineage crosses partitions: ${item.lineageGroupId}`);
    partitions.set(item.lineageGroupId, item.partition);
    if (lineageCases.has(item.lineageGroupId)) failures.push(`duplicate lineage evaluation: ${item.lineageGroupId}`);
    lineageCases.add(item.lineageGroupId);
  }
  if (failures.length) throw new Error(`Invalid evaluation corpus: ${failures.join("; ")}`);
  return true;
}
