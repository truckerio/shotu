import {
  enableGlobalLayoutConsent,
  activateGlobalLayoutHmacVersion,
  enqueueGlobalLayoutContributionCommand,
  findActiveGlobalLayoutTemplates,
  getGlobalLayoutConsent,
  getGlobalLayoutConsentEvent,
  recordGlobalLayoutConsentEvent,
  sealGlobalLayoutReleaseEvidence,
  transitionGlobalLayoutArtifact,
  withdrawGlobalLayoutConsent,
  withGlobalLayoutTransaction,
} from "../../db/repositories/invoice-global-layouts.repo.js";
import {
  GLOBAL_LAYOUT_SCHEMA_VERSION,
  buildGlobalInvoiceLayoutContribution,
  replayGlobalLayoutEvidence,
  scanGlobalLayoutPayload,
} from "./invoice-global-layout.js";

const POLICY_VERSION_PATTERN = /^[a-z0-9._-]{1,40}$/;

function assertCompanyAdmin(requestContext, companyId) {
  if (requestContext?.actor?.role !== "admin" || !requestContext?.companyIds?.has(companyId)) {
    const error = new Error("Global invoice layout policy is not available.");
    error.code = "invoice_global_layout_not_found";
    error.statusCode = 404;
    throw error;
  }
}

function policyInput(input) {
  const expectedVersion = Number(input?.expectedVersion);
  const policyVersion = String(input?.policyVersion || "").trim();
  const idempotencyKey = String(input?.idempotencyKey || "").trim();
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0
    || !POLICY_VERSION_PATTERN.test(policyVersion)
    || idempotencyKey.length < 8 || idempotencyKey.length > 120) {
    throw new Error("invoice_global_layout_invalid_policy_command");
  }
  return { expectedVersion, policyVersion, idempotencyKey };
}

export async function readGlobalLayoutPolicy(companyId, requestContext, dependencies = {}) {
  assertCompanyAdmin(requestContext, companyId);
  const readConsent = dependencies.getConsent || getGlobalLayoutConsent;
  const consent = await readConsent({ companyId });
  return consent || { company_id: companyId, state: "disabled", policy_version: null, version: 0, changed_at: null };
}

export async function changeGlobalLayoutPolicy(companyId, input, requestContext, dependencies = {}) {
  assertCompanyAdmin(requestContext, companyId);
  const parsed = { ...policyInput(input), enabled: input?.enabled === true };
  const transact = dependencies.transaction || withGlobalLayoutTransaction;
  return transact(async (db) => {
    const previousEvent = await (dependencies.getConsentEvent || getGlobalLayoutConsentEvent)({
      companyId, idempotencyKey: parsed.idempotencyKey,
    }, db);
    const intendedAction = parsed.enabled ? "enabled" : "withdrawal_requested";
    if (previousEvent) {
      if (previousEvent.action !== intendedAction || previousEvent.policy_version !== parsed.policyVersion) {
        throw new Error("invoice_global_layout_idempotency_conflict");
      }
      const consent = await (dependencies.getConsent || getGlobalLayoutConsent)({ companyId }, db);
      return { consent, rebuilds: [], replayed: true };
    }
    if (parsed.enabled) {
      const change = dependencies.enableConsent || enableGlobalLayoutConsent;
      const consent = await change({
        companyId, actorId: requestContext.actor.id, policyVersion: parsed.policyVersion,
        expectedVersion: parsed.expectedVersion,
      }, db);
      if (!consent) throw new Error("invoice_global_layout_policy_conflict");
      await (dependencies.recordConsentEvent || recordGlobalLayoutConsentEvent)({
        companyId, actorId: requestContext.actor.id, action: "enabled",
        policyVersion: parsed.policyVersion, idempotencyKey: parsed.idempotencyKey,
      }, db);
      return { consent, rebuilds: [] };
    }
    await (dependencies.recordConsentEvent || recordGlobalLayoutConsentEvent)({
      companyId, actorId: requestContext.actor.id, action: "withdrawal_requested",
      policyVersion: parsed.policyVersion, idempotencyKey: parsed.idempotencyKey,
    }, db);
    const withdraw = dependencies.withdrawConsent || withdrawGlobalLayoutConsent;
    const result = await withdraw({
      companyId, actorId: requestContext.actor.id, expectedVersion: parsed.expectedVersion,
    }, db);
    if (!result) throw new Error("invoice_global_layout_policy_conflict");
    return result;
  });
}

export function evaluateGlobalLayoutPromotion(contributions, thresholds = {}) {
  const minimumDocuments = Math.max(5, Number(thresholds.minimumDocuments) || 5);
  const minimumCompanies = Math.max(3, Number(thresholds.minimumCompanies) || 3);
  const maximumCompanyShare = Math.min(0.4, Number(thresholds.maximumCompanyShare) || 0.4);
  const minimumCriticalExactMatch = Math.max(0.98, Number(thresholds.minimumCriticalExactMatch) || 0.98);
  const maximumFalseMatchRate = Math.min(0.001, Number(thresholds.maximumFalseMatchRate) || 0.001);
  const eligible = contributions.filter((item) => item.replay_evidence?.positiveMatched === true);
  const companyCounts = new Map();
  for (const item of eligible) companyCounts.set(item.company_id, (companyCounts.get(item.company_id) || 0) + 1);
  const supportCount = eligible.length;
  const companyCount = companyCounts.size;
  const maxCompanyShare = supportCount
    ? Math.max(...companyCounts.values()) / supportCount : 1;
  const applicableCriticalFields = eligible.reduce((sum, item) => sum + Number(item.replay_evidence.applicableCriticalFields || 0), 0);
  const correctCriticalFields = eligible.reduce((sum, item) => sum + Number(item.replay_evidence.correctCriticalFields || 0), 0);
  const criticalExactMatch = applicableCriticalFields ? correctCriticalFields / applicableCriticalFields : 0;
  const totalsApplicableCount = eligible.filter((item) => item.replay_evidence.totalsApplicable === true).length;
  const totalsReconciledCount = eligible.filter((item) => item.replay_evidence.totalsReconcile === true).length;
  const totalsReconcileRate = totalsApplicableCount ? totalsReconciledCount / totalsApplicableCount : 0;
  const negativeCount = eligible.reduce((sum, item) => sum + Number(item.replay_evidence.explicitNegativeCount || 0), 0);
  const falsePositiveCount = eligible.reduce((sum, item) => sum + Number(item.replay_evidence.falsePositiveCount || 0), 0);
  const falseMatchRate = negativeCount ? falsePositiveCount / negativeCount : 1;
  const metrics = {
    supportCount, companyCount, maxCompanyShare, criticalExactMatch,
    totalsReconcileRate, falseMatchRate, negativeCount, falsePositiveCount,
    replayEvidenceComplete: applicableCriticalFields > 0 && totalsApplicableCount > 0 && negativeCount >= 1000,
  };
  const reasons = [];
  if (supportCount < minimumDocuments) reasons.push("insufficient_documents");
  if (companyCount < minimumCompanies) reasons.push("insufficient_companies");
  if (maxCompanyShare > maximumCompanyShare) reasons.push("company_dominance");
  if (criticalExactMatch < minimumCriticalExactMatch) reasons.push("critical_accuracy");
  if (totalsReconcileRate !== 1) reasons.push("totals_reconciliation");
  if (falseMatchRate >= maximumFalseMatchRate) reasons.push("false_match_rate");
  if (!metrics.replayEvidenceComplete) reasons.push("unsealed_replay_evidence");
  return { eligible: reasons.length === 0, reasons, metrics };
}

export async function contributeGlobalInvoiceLayout(input, requestContext, dependencies = {}) {
  const companyId = String(input?.companyId || "");
  if (!requestContext?.companyIds?.has(companyId)) throw new Error("invoice_global_layout_not_found");
  if (input?.reviewerConfirmed !== true) return { status: "not_requested" };
  const consent = await (dependencies.getConsent || getGlobalLayoutConsent)({ companyId });
  if (consent?.state !== "enabled") return { status: "company_opt_out" };
  let built;
  try {
    built = (dependencies.buildContribution || buildGlobalInvoiceLayoutContribution)({
      observation: input.observation, reviewedDraft: input.reviewedDraft, keyring: input.keyring,
    });
  } catch (error) {
    if (error?.message === "invoice_global_layout_unsupported_grammar") {
      return { status: "unsupported_grammar" };
    }
    throw error;
  }
  const replayEvidence = (dependencies.replayEvidence || replayGlobalLayoutEvidence)({
    payload: built.payload,
    observation: input.observation,
    reviewedDraft: input.reviewedDraft,
    negativeObservations: input.negativeObservations || [],
    keyring: input.keyring,
  });
  await (dependencies.activateHmacVersion || activateGlobalLayoutHmacVersion)({
    keyVersion: built.payload.hmacKeyVersion,
  });
  const command = await (dependencies.enqueueContribution || enqueueGlobalLayoutContributionCommand)({
    companyId,
    runId: input.runId,
    reviewerId: requestContext.actor.id,
    reviewRequestHash: input.reviewRequestHash,
    structuralFingerprint: built.structuralFingerprint,
    schemaVersion: GLOBAL_LAYOUT_SCHEMA_VERSION,
    hmacKeyVersion: built.payload.hmacKeyVersion,
    sanitizedPayload: built.payload,
    privacyScannerVersion: built.privacyScan.scannerVersion,
    privacyScanDigest: built.privacyScan.scanDigest,
    replayEvidence,
    companyLayoutCap: Math.min(20, Math.max(1, Number(input.companyLayoutCap) || 5)),
  });
  if (!command) return { status: "ineligible" };
  const durableStatus = ["pending", "processing"].includes(command.status) || !command.status
    ? "queued" : command.status;
  return { status: durableStatus, replayed: command.replayed === true };
}

export async function governGlobalLayoutRelease(input, dependencies = {}) {
  if (typeof dependencies.verifySealedManifest !== "function"
    || await dependencies.verifySealedManifest(input) !== true) {
    throw new Error("invoice_global_layout_unverified_release_evidence");
  }
  const transact = dependencies.transaction || withGlobalLayoutTransaction;
  return transact(async (db) => {
    const sealEvidence = dependencies.sealEvidence || sealGlobalLayoutReleaseEvidence;
    const evidence = await sealEvidence(input.evidence, db);
    if (!evidence) throw new Error("invoice_global_layout_release_evidence_conflict");
    const transition = dependencies.transitionArtifact || transitionGlobalLayoutArtifact;
    const artifact = await transition({
      id: input.evidence.templateId,
      expectedStatus: input.expectedStatus,
      nextStatus: input.nextStatus,
      releaseEvidenceId: evidence.id,
      reasonCode: input.reasonCode || "sealed_evaluation_passed",
    }, db);
    if (!artifact) throw new Error("invoice_global_layout_release_gate_failed");
    return { artifact, evidenceId: evidence.id };
  });
}

export async function findGovernedActiveGlobalLayouts(input, dependencies = {}) {
  const keyring = input.keyring;
  if (!keyring || keyring.version !== input.hmacKeyVersion) throw new Error("invoice_global_layout_hmac_unavailable");
  const findTemplates = dependencies.findTemplates || findActiveGlobalLayoutTemplates;
  const templates = await findTemplates(input);
  return templates.filter((template) => {
    try {
      const scan = scanGlobalLayoutPayload(template.template_payload, keyring);
      return scan.scannerVersion === template.privacy_scanner_version
        && scan.scanDigest === template.privacy_scan_digest;
    } catch {
      return false;
    }
  });
}
