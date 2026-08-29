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
import { reconcileInvoiceDrafts } from "./invoice-draft-reconciliation.js";
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
import { extractInvoiceWithLocalOcr, extractNativePdfText, ocrObservation } from "./providers/local-ocr.provider.js";
import { extractInvoiceWithOpenAI } from "./providers/openai-invoice.provider.js";
import { classifyInvoiceAiContext } from "./invoice-ai-security.js";
import {
  capGlobalTemplateConfidence,
  configuredGlobalLayoutKeyrings,
  globalLayoutAsLocalTemplate,
  globalObservationMarkerDigests,
  matchGlobalInvoiceLayout,
} from "./invoice-global-layout.js";
import { contributeGlobalInvoiceLayout, findGovernedActiveGlobalLayouts } from "./invoice-global-learning.service.js";

async function authorizedLocation(input, requestContext, dependencies) {
  const companyIds = [...(requestContext.companyIds || [])];
  const location = await (dependencies.getLocationById || getLocationById)(input.locationId, companyIds);
  if (!location || (requestContext.actor.role !== "admin" && !requestContext.locationIds?.has(location.id))) {
    throw new InvoiceExtractionError("Location is not available.", { code: "location_not_found", statusCode: 404 });
  }
  return location;
}

export function guardPaidBalanceAsInvoiceTotal(draft, tolerance = 0.02) {
  const rawTotal = draft?.total?.value;
  const subtotal = Number(draft?.subtotal?.value);
  const total = Number(rawTotal);
  const lineTotals = draft?.lines?.map((line) => line?.lineTotal?.value) || [];
  const hasAllLineTotals = lineTotals.length > 0
    && lineTotals.every((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  const lineSum = lineTotals.reduce((sum, value) => sum + Number(value || 0), 0);
  if (!(subtotal > 0 && rawTotal !== null && rawTotal !== undefined && total === 0
    && hasAllLineTotals && Math.abs(lineSum - subtotal) <= tolerance)) return draft;

  return {
    ...draft,
    total: {
      value: null,
      confidence: 0,
      evidence: "Printed zero may be a paid balance rather than the original invoice total; confirm the invoice total.",
    },
    warnings: [...new Set([
      ...(draft.warnings || []),
      "A paid balance may have been mistaken for the invoice total; confirm the original invoice total.",
    ])],
  };
}

export function nativePdfTextIsUsable(value) {
  const text = String(value || "").trim();
  if (text.length < 200) return false;
  const invoiceSignal = /\b(?:invoice|credit memo|parts invoice)\b/i.test(text);
  const identitySignal = /\b(?:invoice\s*(?:number|no\.?|#)|date|customer[- ]?po|purchase order)\b/i.test(text);
  const amountSignal = /\b(?:sub\s*total|sales tax|total|please pay)\b/i.test(text) && /\d+[.,]\d{2}\b/.test(text);
  return invoiceSignal && identitySignal && amountSignal;
}

function globalKeyrings() {
  return configuredGlobalLayoutKeyrings({
    activeVersion: invoiceExtractionConfig.globalLayoutHmacKeyVersion,
    serializedKeys: invoiceExtractionConfig.globalLayoutHmacKeys,
  });
}

async function globalCandidateFromOcr(ocr, genericDraft, dependencies) {
  if (!genericDraft) return null;
  const observation = ocrObservation(ocr);
  const keyrings = dependencies.globalLayoutKeyrings || globalKeyrings();
  const loadGlobalTemplates = dependencies.loadGlobalTemplates || findGovernedActiveGlobalLayouts;
  const candidates = [];
  for (const keyring of keyrings) {
    let markerDigests;
    try {
      markerDigests = globalObservationMarkerDigests(observation, keyring);
    } catch {
      continue;
    }
    if (markerDigests.length < 3) continue;
    const templates = await loadGlobalTemplates({
      markerDigests,
      schemaVersion: 1,
      hmacKeyVersion: keyring.version,
      keyring,
      limit: 10,
    });
    for (const template of templates || []) {
      try {
        const match = matchGlobalInvoiceLayout(observation, template.template_payload, keyring);
        if (match.matched) candidates.push({ template, match });
      } catch {
        // Unknown or incompatible key/schema versions fail closed to generic extraction.
      }
    }
  }
  const best = candidates.sort((left, right) => right.match.score - left.match.score)[0];
  if (!best) return null;
  const structuralDraft = buildInvoiceDraftFromTemplate({
    observation,
    template: globalLayoutAsLocalTemplate(best.template.template_payload),
  });
  return {
    draft: capGlobalTemplateConfidence(reconcileInvoiceDrafts({
      primaryDraft: genericDraft,
      localDraft: structuralDraft,
      primarySource: "local_generic",
      localSource: "global_layout",
    })),
    provider: "local_global_reconciled",
    model: `${ocr.provider}:${ocr.providerVersion}+global-layout:${String(best.template.structural_fingerprint || "").slice(0, 12)}`,
    promptVersion: "global-layout-v1+generic-reconciliation-v1",
    usage: {},
  };
}

async function localCandidateFromOcr(ocr, activeTemplates, dependencies = {}) {
  const observation = ocrObservation(ocr);
  const matches = activeTemplates
    .map((template) => ({ template, match: matchInvoiceTemplate(observation, template.template_payload) }))
    .filter(({ match }) => match.matched)
    .sort((left, right) => right.match.score - left.match.score);
  if (matches[0]) {
    const localDraft = buildInvoiceDraftFromTemplate({ observation, template: matches[0].template.template_payload });
    if (localTemplateDraftIsUsable(localDraft)) {
      return {
        draft: localDraft,
        provider: "local_template",
        model: `${ocr.provider}:${ocr.providerVersion}+layout:${matches[0].template.fingerprint.slice(0, 12)}`,
        promptVersion: "local-layout-v1",
        usage: {},
      };
    }
  }
  const genericDraft = extractGenericInvoiceDraft({ observation, ocrText: ocr.text });
  if (!genericDraftHasEvidence(genericDraft)) return null;
  const globalCandidate = await globalCandidateFromOcr(ocr, genericDraft, dependencies);
  if (globalCandidate) return globalCandidate;
  return {
    draft: genericDraft,
    provider: "local_generic",
    model: `${ocr.provider}:${ocr.providerVersion}+generic-invoice-v1`,
    promptVersion: "local-generic-v1",
    usage: {},
  };
}

async function settledResult(promise) {
  try {
    return { value: await promise, error: null };
  } catch (error) {
    return { value: null, error };
  }
}

export async function executeInvoiceExtractionRun({
  run,
  location,
  parsed,
  document,
  memory,
  activeTemplates,
}, dependencies = {}) {
  const startedAt = performance.now();
  try {
    if (invoiceExtractionConfig.remoteProviderEnabled && !invoiceExtractionConfig.openAiApiKey) {
      throw new InvoiceExtractionError("Remote invoice extraction is enabled but not configured.", {
        code: "provider_not_configured",
        statusCode: 503,
        retryable: false,
      });
    }
    let nativeDocumentText = "";
    if (parsed.mimeType === "application/pdf" && invoiceExtractionConfig.ocrBaseUrl) {
      const native = await settledResult((dependencies.extractNativeText || extractNativePdfText)({
        bytes: document.bytes,
        mimeType: parsed.mimeType,
        fileName: parsed.fileName,
      }, dependencies.nativeTextOptions || {}));
      if (native.error && !(native.error instanceof InvoiceExtractionError)) throw native.error;
      nativeDocumentText = native.value?.text || "";
    }
    const canUseNativeFastPath = Boolean(invoiceExtractionConfig.openAiApiKey)
      && nativePdfTextIsUsable(nativeDocumentText);
    const ocrPromise = invoiceExtractionConfig.ocrBaseUrl && !canUseNativeFastPath
      ? settledResult((dependencies.extractWithOcr || extractInvoiceWithLocalOcr)({
        bytes: document.bytes,
        mimeType: parsed.mimeType,
        fileName: parsed.fileName,
      }, dependencies.ocrOptions || {}))
      : Promise.resolve({ value: null, error: null });
    const providerPromise = invoiceExtractionConfig.openAiApiKey
      ? settledResult((dependencies.extractWithProvider || extractInvoiceWithOpenAI)(parsed, {
        ...memory,
        localOcrText: "",
        nativeDocumentText,
      }, dependencies.providerOptions || {}))
      : Promise.resolve({ value: null, error: null });
    const [ocrResult, openAiSettled] = await Promise.all([ocrPromise, providerPromise]);
    if (ocrResult.error && !(ocrResult.error instanceof InvoiceExtractionError)) throw ocrResult.error;
    if (openAiSettled.error && !(openAiSettled.error instanceof InvoiceExtractionError)) throw openAiSettled.error;
    const localCandidate = ocrResult.value ? await localCandidateFromOcr(ocrResult.value, activeTemplates, dependencies) : null;
    let providerResult = null;
    if (openAiSettled.value) {
      const openAiResult = openAiSettled.value;
      const remoteCandidate = {
        ...(openAiResult.draft ? openAiResult : { draft: openAiResult }),
        provider: "openai",
        model: invoiceExtractionConfig.model,
        promptVersion: invoiceExtractionConfig.promptVersion,
      };
      providerResult = localCandidate ? {
        ...remoteCandidate,
        draft: reconcileInvoiceDrafts({
          primaryDraft: remoteCandidate.draft,
          localDraft: localCandidate.draft,
          primarySource: "openai",
          localSource: localCandidate.provider,
        }),
        provider: "hybrid_reconciled",
        model: `${remoteCandidate.model}+${localCandidate.model}`.slice(0, 120),
        promptVersion: `${remoteCandidate.promptVersion}+candidate-reconciliation-v1`,
      } : remoteCandidate;
    } else if (localCandidate) {
      providerResult = invoiceExtractionConfig.openAiApiKey ? {
        ...localCandidate,
        draft: {
          ...localCandidate.draft,
          warnings: [...new Set([
            ...(localCandidate.draft.warnings || []),
            "Remote extraction was unavailable; this draft uses local OCR and must be reviewed.",
          ])],
        },
      } : localCandidate;
    } else {
      const extractionError = openAiSettled.error || ocrResult.error;
      if (extractionError) throw extractionError;
    }
    if (!providerResult) {
      throw new InvoiceExtractionError("Invoice extraction produced no usable document evidence.", {
        code: "provider_empty_result",
        statusCode: 502,
        retryable: true,
      });
    }
    const draft = guardPaidBalanceAsInvoiceTotal(providerResult.draft || providerResult);
    const security = classifyInvoiceAiContext({
      vendorHint: parsed.vendorHint,
      localOcrText: ocrResult.value?.text || "",
      nativeDocumentText,
      approvedMemoryText: `${JSON.stringify(memory)}\n${JSON.stringify(draft)}`,
    });
    const securityWarnings = security.requiresReview
      ? ["Potential instruction-like document content was detected; verify every extracted value and do not approve learning unless the document is trusted."]
      : [];
    const warnings = [...new Set([...draft.warnings, ...reconciliationWarnings(draft), ...securityWarnings])];
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
    if (!completed) {
      throw new InvoiceExtractionError("Invoice extraction state changed before completion.", {
        code: "invoice_extraction_conflict",
        statusCode: 409,
        retryable: true,
      });
    }
    return { run: publicInvoiceExtractionRun(completed), replayed: false };
  } catch (error) {
    const safe = error instanceof InvoiceExtractionError
      ? error
      : new InvoiceExtractionError("Invoice extraction failed.", { code: "provider_error", statusCode: 502, retryable: true });
    if (!dependencies.deferFailure) {
      await (dependencies.failRun || failInvoiceExtractionRun)({
        runId: run.id,
        companyId: location.company_id,
        errorCode: safe.code,
        retryable: safe.retryable,
        durationMs: Math.round(performance.now() - startedAt),
      });
    }
    throw safe;
  }
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
    loadMemory({ companyId: location.company_id, vendorKey, factLimit: 20, playbookLimit: 5, exampleLimit: 3 }),
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
    provider: invoiceExtractionConfig.openAiApiKey ? "openai" : "hybrid_local_first",
    model: invoiceExtractionConfig.openAiApiKey
      ? invoiceExtractionConfig.model
      : activeTemplates.length ? "paddleocr+learned-layout" : "paddleocr+generic-invoice-v1",
    promptVersion: invoiceExtractionConfig.promptVersion,
    memorySnapshot: memorySnapshot(memory),
    vendorHint: parsed.vendorHint,
    enqueueJob: dependencies.deferProcessing === true,
    maxAttempts: invoiceExtractionConfig.workerMaxAttempts,
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

  if (dependencies.deferProcessing) {
    return { run: publicInvoiceExtractionRun(run), replayed: false };
  }

  return executeInvoiceExtractionRun({
    run,
    location,
    parsed: { ...parsed, fileName },
    document,
    memory,
    activeTemplates,
  }, dependencies);
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
  let candidates = semanticCandidatesFromCorrections(row.extracted_draft, parsed.reviewedDraft, corrections);
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
  let globalContributionStatus = parsed.approveGlobalStructureContribution ? "skipped" : "not_requested";
  let globalContributionObservation = null;
  let learningSecurity = null;
  const learningRequested = parsed.approveLearning || parsed.approveGlobalStructureContribution;
  if (learningRequested && row.status !== "reviewed" && invoiceExtractionConfig.ocrBaseUrl) {
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
      learningSecurity = classifyInvoiceAiContext({
        localOcrText: ocr.text,
        approvedMemoryText: `${JSON.stringify(row.extracted_draft)}\n${JSON.stringify(parsed.reviewedDraft)}`,
      });
      globalContributionObservation = observation;
      const vendorKey = normalizeVendorKey(parsed.reviewedDraft.vendorName.value);
      if (parsed.approveLearning && learningSecurity.blockLearning) {
        layoutLearningStatus = "security_blocked";
      } else if (parsed.approveLearning && vendorKey) {
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
      } else if (parsed.approveLearning) {
        layoutLearningStatus = "vendor_required";
      }
    } catch (error) {
      if (!(error instanceof InvoiceExtractionError)) throw error;
      layoutLearningStatus = error.code;
    }
  }
  const effectiveApproveLearning = parsed.approveLearning && !learningSecurity?.blockLearning;
  if (learningSecurity?.blockLearning) candidates = [];
  const requestHash = reviewRequestHash(parsed);
  if (parsed.approveGlobalStructureContribution) {
    const keyring = (dependencies.globalLayoutKeyrings || globalKeyrings())[0];
    if (learningSecurity?.blockLearning) globalContributionStatus = "security_blocked";
    else if (!globalContributionObservation) globalContributionStatus = row.status === "reviewed" ? "queued" : "ocr_unavailable";
    else if (!keyring) globalContributionStatus = "hmac_unavailable";
    else {
      const result = await (dependencies.contributeGlobalLayout || contributeGlobalInvoiceLayout)({
        companyId: row.company_id,
        runId,
        reviewerConfirmed: true,
        reviewRequestHash: requestHash,
        observation: globalContributionObservation,
        reviewedDraft: parsed.reviewedDraft,
        keyring,
        negativeObservations: [],
      }, requestContext, dependencies.globalContributionDependencies || {});
      globalContributionStatus = result.status;
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
    approveLearning: effectiveApproveLearning,
    trainingExample,
    layoutTemplateLearning,
    requestHash,
  });
  if (!reviewed) throw invoiceNotFound();
  return {
    run: publicInvoiceExtractionRun(reviewed),
    correctionCount: corrections.length,
    layoutLearningStatus,
    globalContributionStatus,
  };
}
