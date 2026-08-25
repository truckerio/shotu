import { randomUUID } from "node:crypto";
import { getLocationById } from "../../db/repositories/locations.repo.js";
import {
  completeInvoiceExtractionRun,
  createInvoiceExtractionRun,
  failInvoiceExtractionRun,
  getInvoiceExtractionRun,
  getInvoiceSourceDocument,
  loadInvoiceLayoutTemplates,
  loadInvoiceExtractionMemory,
  publicInvoiceExtractionRun,
  recordInvoiceSourceAccess,
  reviewInvoiceExtractionRun,
} from "../../db/repositories/invoice-extractions.repo.js";
import { decryptInvoiceDocument, encryptInvoiceDocument } from "./invoice-document.crypto.js";
import { invoiceExtractionConfig } from "./invoice-extraction.config.js";
import { assertInvoiceFileExtension, decodeInvoiceDocument, safeInvoiceFileName } from "./invoice-extraction.document.js";
import { InvoiceExtractionError, invoiceNotFound } from "./invoice-extraction.errors.js";
import { extractGenericInvoiceDraft, genericDraftHasEvidence } from "./invoice-generic-extractor.js";
import {
  correctionEvents,
  extractionNeedsReview,
  memorySnapshot,
  reconciliationWarnings,
  semanticCandidatesFromCorrections,
  reviewRequestHash,
} from "./invoice-extraction.learning.js";
import {
  buildInvoiceDraftFromTemplate,
  learnInvoiceTemplateCandidate,
  localTemplateDraftIsUsable,
  matchInvoiceTemplate,
} from "./invoice-template-learning.js";
import { extractInvoiceInputSchema, normalizeVendorKey, reviewInvoiceInputSchema } from "./invoice-extraction.schemas.js";
import { extractInvoiceWithLocalOcr, ocrObservation } from "./providers/local-ocr.provider.js";
import { extractInvoiceWithOpenAI } from "./providers/openai-invoice.provider.js";

async function authorizedLocation(input, requestContext, dependencies) {
  const companyIds = [...(requestContext.companyIds || [])];
  const location = await (dependencies.getLocationById || getLocationById)(input.locationId, companyIds);
  if (!location || (requestContext.actor.role !== "admin" && !requestContext.locationIds?.has(location.id))) {
    throw new InvoiceExtractionError("Location is not available.", { code: "location_not_found", statusCode: 404 });
  }
  return location;
}

export async function extractInvoice(input, requestContext, dependencies = {}) {
  const parsed = extractInvoiceInputSchema.parse(input);
  const location = await authorizedLocation(parsed, requestContext, dependencies);
  const fileName = safeInvoiceFileName(parsed.fileName);
  assertInvoiceFileExtension(fileName, parsed.mimeType);
  const document = decodeInvoiceDocument(parsed);
  const runId = randomUUID();
  const encryptDocument = dependencies.encryptDocument || encryptInvoiceDocument;
  const source = encryptDocument(document.bytes, {
    companyId: location.company_id,
    runId,
    documentHash: document.documentHash,
    mimeType: parsed.mimeType,
  });
  const vendorKey = normalizeVendorKey(parsed.vendorHint);
  const loadMemory = dependencies.loadMemory || loadInvoiceExtractionMemory;
  const loadTemplates = dependencies.loadTemplates || loadInvoiceLayoutTemplates;
  const [memory, activeTemplates] = await Promise.all([
    loadMemory({ companyId: location.company_id, vendorKey, factLimit: 20, playbookLimit: 5 }),
    loadTemplates({ companyId: location.company_id, vendorKey, statuses: ["active"], limit: 25 }),
  ]);
  const createRun = dependencies.createRun || createInvoiceExtractionRun;
  const run = await createRun({
    runId,
    companyId: location.company_id,
    locationId: location.id,
    actorId: requestContext.actor.id,
    documentHash: document.documentHash,
    fileName,
    mimeType: parsed.mimeType,
    byteSize: document.byteSize,
    idempotencyKey: parsed.idempotencyKey,
    provider: "hybrid_local_first",
    model: activeTemplates.length ? "paddleocr+learned-layout" : invoiceExtractionConfig.model,
    promptVersion: invoiceExtractionConfig.promptVersion,
    memorySnapshot: memorySnapshot(memory),
    source,
    retentionUntil: new Date(Date.now() + invoiceExtractionConfig.documentRetentionDays * 86_400_000).toISOString(),
  });
  if (!run) throw new Error("Invoice extraction run could not be created.");
  if (!run.inserted) {
    if (run.document_hash !== document.documentHash || run.location_id !== location.id || run.mime_type !== parsed.mimeType) {
      throw new InvoiceExtractionError("This idempotency key was already used for a different invoice.", { code: "idempotency_conflict", statusCode: 409 });
    }
    return { run: publicInvoiceExtractionRun(run), replayed: true };
  }

  const startedAt = performance.now();
  try {
    let providerResult = null;
    if (invoiceExtractionConfig.ocrBaseUrl) {
      try {
        const ocr = await (dependencies.extractWithOcr || extractInvoiceWithLocalOcr)({
          bytes: document.bytes,
          mimeType: parsed.mimeType,
          fileName,
        }, dependencies.ocrOptions || {});
        const observation = ocrObservation(ocr);
        const matches = activeTemplates
          .map((template) => ({ template, match: matchInvoiceTemplate(observation, template.template_payload) }))
          .filter(({ match }) => match.matched)
          .sort((left, right) => right.match.score - left.match.score);
        if (matches[0]) {
          const localDraft = buildInvoiceDraftFromTemplate({ observation, template: matches[0].template.template_payload });
          if (localTemplateDraftIsUsable(localDraft)) {
            providerResult = {
              draft: localDraft,
              provider: "local_template",
              model: `${ocr.provider}:${ocr.providerVersion}+layout:${matches[0].template.fingerprint.slice(0, 12)}`,
              promptVersion: "local-layout-v1",
              usage: {},
            };
          }
        }
        if (!providerResult) {
          const genericDraft = extractGenericInvoiceDraft({ observation, ocrText: ocr.text });
          if (genericDraftHasEvidence(genericDraft) || !invoiceExtractionConfig.openAiApiKey) {
            providerResult = {
              draft: genericDraft,
              provider: "local_generic",
              model: `${ocr.provider}:${ocr.providerVersion}+generic-invoice-v1`,
              promptVersion: "local-generic-v1",
              usage: {},
            };
          }
        }
      } catch (error) {
        if (!(error instanceof InvoiceExtractionError)) throw error;
      }
    }
    if (!providerResult) {
      const openAiResult = await (dependencies.extractWithProvider || extractInvoiceWithOpenAI)({
        ...parsed,
        fileName,
      }, memory, dependencies.providerOptions || {});
      providerResult = {
        ...(openAiResult.draft ? openAiResult : { draft: openAiResult }),
        provider: "openai",
        model: invoiceExtractionConfig.model,
        promptVersion: invoiceExtractionConfig.promptVersion,
      };
    }
    const draft = providerResult.draft || providerResult;
    const warnings = [...new Set([...draft.warnings, ...reconciliationWarnings(draft)])];
    const finalDraft = { ...draft, warnings };
    const status = extractionNeedsReview(finalDraft) ? "needs_review" : "completed";
    const completed = await (dependencies.completeRun || completeInvoiceExtractionRun)({
      runId: run.id,
      companyId: location.company_id,
      draft: finalDraft,
      status,
      durationMs: Math.round(performance.now() - startedAt),
      providerResponseId: providerResult.providerResponseId || null,
      usage: providerResult.usage || {},
      provider: providerResult.provider,
      model: providerResult.model,
      promptVersion: providerResult.promptVersion,
    });
    if (!completed) throw new InvoiceExtractionError("Invoice extraction state changed before completion.", { code: "invoice_extraction_conflict", statusCode: 409, retryable: true });
    return { run: publicInvoiceExtractionRun(completed), replayed: false };
  } catch (error) {
    const safe = error instanceof InvoiceExtractionError
      ? error
      : new InvoiceExtractionError("Invoice extraction failed.", { code: "provider_error", statusCode: 502, retryable: true });
    await (dependencies.failRun || failInvoiceExtractionRun)({
      runId: run.id,
      companyId: location.company_id,
      errorCode: safe.code,
      retryable: safe.retryable,
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw safe;
  }
}

export async function readInvoiceSource(runId, requestContext, dependencies = {}) {
  const source = await (dependencies.getSource || getInvoiceSourceDocument)({
    runId,
    companyIds: [...requestContext.companyIds],
    locationIds: [...requestContext.locationIds],
    isAdmin: requestContext.actor.role === "admin",
  });
  if (!source) throw invoiceNotFound();
  if (requestContext.actor.role !== "admin" && !requestContext.locationIds.has(source.location_id)) throw invoiceNotFound();
  const bytes = (dependencies.decryptDocument || decryptInvoiceDocument)(source);
  await (dependencies.recordSourceAccess || recordInvoiceSourceAccess)({
    source,
    actorId: requestContext.actor.id,
    action: "view",
  });
  return { bytes, mimeType: source.mime_type, byteSize: Number(source.byte_size) };
}

export async function readInvoiceExtraction(runId, requestContext, dependencies = {}) {
  const row = await (dependencies.getRun || getInvoiceExtractionRun)({
    runId,
    companyIds: [...requestContext.companyIds],
  });
  if (!row) throw invoiceNotFound();
  if (requestContext.actor.role !== "admin" && !requestContext.locationIds.has(row.location_id)) throw invoiceNotFound();
  return { run: publicInvoiceExtractionRun(row) };
}

export async function reviewInvoice(runId, input, requestContext, dependencies = {}) {
  const parsed = reviewInvoiceInputSchema.parse(input);
  const row = await (dependencies.getRun || getInvoiceExtractionRun)({ runId, companyIds: [...requestContext.companyIds] });
  if (!row || (requestContext.actor.role !== "admin" && !requestContext.locationIds.has(row.location_id))) throw invoiceNotFound();
  if (!row.extracted_draft) throw new InvoiceExtractionError("This extraction has no draft to review.", { code: "invoice_draft_unavailable", statusCode: 409 });
  const corrections = correctionEvents(row.extracted_draft, parsed.reviewedDraft);
  const candidates = semanticCandidatesFromCorrections(row.extracted_draft, parsed.reviewedDraft, corrections);
  const trainingExample = {
    vendorKey: normalizeVendorKey(parsed.reviewedDraft.vendorName.value),
    qualityMetrics: {
      correctionCount: corrections.length,
      predictedWarningCount: Array.isArray(row.extracted_draft.warnings) ? row.extracted_draft.warnings.length : 0,
      reviewedWarningCount: parsed.reviewedDraft.warnings.length,
      totalsReconcile: reconciliationWarnings(parsed.reviewedDraft).length === 0,
    },
  };
  let layoutTemplateLearning = null;
  let layoutLearningStatus = parsed.approveLearning ? "skipped" : "not_requested";
  if (parsed.approveLearning && row.status !== "reviewed" && invoiceExtractionConfig.ocrBaseUrl) {
    try {
      const source = await (dependencies.getLearningSource || getInvoiceSourceDocument)({
        runId,
        companyIds: [...requestContext.companyIds],
        locationIds: [...requestContext.locationIds],
        isAdmin: requestContext.actor.role === "admin",
      });
      if (!source) throw new InvoiceExtractionError("The source document is unavailable for layout learning.", { code: "invoice_source_unavailable", statusCode: 409 });
      const bytes = (dependencies.decryptDocument || decryptInvoiceDocument)(source);
      await (dependencies.recordSourceAccess || recordInvoiceSourceAccess)({
        source,
        actorId: requestContext.actor.id,
        action: "template_learn",
      });
      const ocr = await (dependencies.extractWithOcr || extractInvoiceWithLocalOcr)({
        bytes,
        mimeType: source.mime_type,
        fileName: row.file_name,
      }, dependencies.ocrOptions || {});
      const observation = ocrObservation(ocr);
      const vendorKey = normalizeVendorKey(parsed.reviewedDraft.vendorName.value);
      if (vendorKey) {
        const existingTemplates = await (dependencies.loadTemplates || loadInvoiceLayoutTemplates)({
          companyId: row.company_id,
          vendorKey,
          statuses: ["candidate", "active"],
          limit: 25,
        });
        const matched = existingTemplates
          .map((template) => ({ template, match: matchInvoiceTemplate(observation, template.template_payload) }))
          .filter(({ match }) => match.matched)
          .sort((left, right) => right.match.score - left.match.score)[0];
        const candidate = learnInvoiceTemplateCandidate({ observation, reviewedDraft: parsed.reviewedDraft });
        if (candidate.signatureMarkers.length >= 3 && candidate.fieldAnchors.length >= 2) {
          layoutTemplateLearning = {
            vendorKey,
            candidate,
            matchedTemplateId: matched?.template.id || null,
            promotionExamples: invoiceExtractionConfig.templatePromotionExamples,
            ocrProvider: ocr.provider,
            ocrVersion: ocr.providerVersion,
          };
          layoutLearningStatus = matched ? "reinforced" : "candidate_created";
        } else {
          layoutLearningStatus = "insufficient_layout_evidence";
        }
      } else {
        layoutLearningStatus = "vendor_required";
      }
    } catch (error) {
      if (!(error instanceof InvoiceExtractionError)) throw error;
      layoutLearningStatus = error.code;
    }
  }
  const reviewed = await (dependencies.reviewRun || reviewInvoiceExtractionRun)({
    actorId: requestContext.actor.id,
    companyIds: [...requestContext.companyIds],
    runId,
    expectedVersion: parsed.expectedVersion,
    idempotencyKey: parsed.idempotencyKey,
    reviewedDraft: parsed.reviewedDraft,
    corrections,
    semanticCandidates: candidates,
    approveLearning: parsed.approveLearning,
    trainingExample,
    layoutTemplateLearning,
    requestHash: reviewRequestHash(parsed),
  });
  if (!reviewed) throw invoiceNotFound();
  return { run: publicInvoiceExtractionRun(reviewed), correctionCount: corrections.length, layoutLearningStatus };
}
