import {
  claimGlobalLayoutRebuild,
  claimGlobalLayoutContributionCommand,
  completeGlobalLayoutContributionCommand,
  completeGlobalLayoutWithdrawal,
  createGlobalLayoutArtifact,
  eligibleGlobalLayoutContributions,
  getGlobalLayoutRebuildForUpdate,
  insertGlobalLayoutContribution,
  lockGlobalLayoutArtifact,
  lockGlobalLayoutHmacLifecycle,
  markGlobalLayoutRebuild,
  retireGlobalLayoutArtifacts,
  withdrawingCompaniesForArtifact,
  withGlobalLayoutTransaction,
} from "../../db/repositories/invoice-global-layouts.repo.js";
import {
  canonicalGlobalLayoutPayload,
  configuredGlobalLayoutKeyrings,
  globalLayoutFingerprint,
  scanGlobalLayoutPayload,
} from "./invoice-global-layout.js";
import { evaluateGlobalLayoutPromotion } from "./invoice-global-learning.service.js";

const DEFAULT_POLL_MS = 30_000;
let pollTimer = null;
let draining = false;

function safeErrorCode(error) {
  const code = String(error?.code || error?.message || "global_layout_rebuild_failed");
  return /^[a-z0-9_]{1,80}$/.test(code) ? code : "global_layout_rebuild_failed";
}

function retryableContributionError(error) {
  return ["invoice_global_layout_hmac_unavailable"].includes(safeErrorCode(error));
}

export function deterministicGlobalLayoutArtifact(contributions) {
  if (!contributions.length) return null;
  const canonical = contributions.map((item) => ({
    payload: canonicalGlobalLayoutPayload(item.sanitized_payload),
    fingerprint: item.structural_fingerprint,
  }));
  const serialized = canonical.map((item) => JSON.stringify(item.payload));
  if (new Set(serialized).size !== 1 || canonical.some((item) => globalLayoutFingerprint(item.payload) !== item.fingerprint)) {
    const error = new Error("global_layout_rebuild_payload_mismatch");
    error.code = "global_layout_rebuild_payload_mismatch";
    throw error;
  }
  const payload = canonical[0].payload;
  return {
    payload,
    markerDigests: [...new Set(payload.signatureRegions.map((marker) => marker.markerHmac))].sort(),
  };
}

function configuredKeyring(version, dependencies = {}) {
  if (typeof dependencies.keyringForVersion === "function") return dependencies.keyringForVersion(version);
  return configuredGlobalLayoutKeyrings({
    activeVersion: process.env.INVOICE_GLOBAL_LAYOUT_HMAC_KEY_VERSION,
    serializedKeys: process.env.INVOICE_GLOBAL_LAYOUT_HMAC_KEYS,
  }).find((keyring) => keyring.version === version) || null;
}

function verifiedContributions(contributions, keyring) {
  return contributions.map((item) => {
    const scan = scanGlobalLayoutPayload(item.sanitized_payload, keyring);
    if (scan.scannerVersion !== item.privacy_scanner_version || scan.scanDigest !== item.privacy_scan_digest) {
      const error = new Error("global_layout_privacy_scan_mismatch");
      error.code = "global_layout_privacy_scan_mismatch";
      throw error;
    }
    return item;
  });
}

export async function runNextGlobalLayoutContribution(dependencies = {}) {
  const transact = dependencies.transaction || withGlobalLayoutTransaction;
  return transact(async (db) => {
    const command = await (dependencies.claimContributionCommand || claimGlobalLayoutContributionCommand)(db);
    if (!command) return null;
    try {
      const keyring = configuredKeyring(command.hmac_key_version, dependencies);
      if (!keyring) throw new Error("invoice_global_layout_hmac_unavailable");
      const scan = scanGlobalLayoutPayload(command.sanitized_payload, keyring);
      if (scan.scannerVersion !== command.privacy_scanner_version || scan.scanDigest !== command.privacy_scan_digest) {
        throw new Error("invoice_global_layout_privacy_scan_mismatch");
      }
      const contribution = await (dependencies.insertContribution || insertGlobalLayoutContribution)({
        companyId: command.company_id,
        runId: command.run_id,
        reviewerId: command.reviewer_id,
        structuralFingerprint: command.structural_fingerprint,
        schemaVersion: Number(command.schema_version),
        hmacKeyVersion: command.hmac_key_version,
        sanitizedPayload: command.sanitized_payload,
        privacyScannerVersion: scan.scannerVersion,
        privacyScanDigest: scan.scanDigest,
        replayEvidence: command.replay_evidence,
        companyLayoutCap: Number(command.company_layout_cap),
      }, db);
      await (dependencies.completeContributionCommand || completeGlobalLayoutContributionCommand)({
        id: command.id, status: contribution ? "completed" : "cancelled",
        errorCode: contribution ? null : "contribution_ineligible",
      }, db);
      return { status: contribution ? "completed" : "cancelled" };
    } catch (error) {
      const retryable = retryableContributionError(error) && Number(command.attempts || 0) < 10;
      await (dependencies.completeContributionCommand || completeGlobalLayoutContributionCommand)({
        id: command.id, status: retryable ? "pending" : "failed", errorCode: safeErrorCode(error),
      }, db);
      return { status: retryable ? "retry_scheduled" : "failed", errorCode: safeErrorCode(error) };
    }
  });
}

export async function rebuildGlobalLayout(rebuild, dependencies = {}) {
  const transact = dependencies.transaction || withGlobalLayoutTransaction;
  return transact(async (db) => {
    const identity = {
      structuralFingerprint: rebuild.structural_fingerprint,
      schemaVersion: Number(rebuild.schema_version),
      hmacKeyVersion: rebuild.hmac_key_version,
    };
    await (dependencies.lockHmacLifecycle || lockGlobalLayoutHmacLifecycle)(db);
    await (dependencies.lockArtifact || lockGlobalLayoutArtifact)(identity, db);
    const current = await (dependencies.getRebuildForUpdate || getGlobalLayoutRebuildForUpdate)({ id: rebuild.id }, db);
    if (!current) return { status: "stale" };
    const keyring = configuredKeyring(identity.hmacKeyVersion, dependencies);
    if (!keyring) throw new Error("invoice_global_layout_hmac_unavailable");
    const loadContributions = dependencies.loadContributions || eligibleGlobalLayoutContributions;
    const contributions = verifiedContributions(await loadContributions(identity, db), keyring);
    const mark = dependencies.markRebuild || markGlobalLayoutRebuild;
    await mark({ id: rebuild.id, status: "validating" }, db);
    let outcome;
    if (!contributions.length) {
      await (dependencies.retireArtifacts || retireGlobalLayoutArtifacts)(identity, db);
      outcome = { status: "retired", reasons: ["no_eligible_contributions"] };
    } else {
      const promotion = (dependencies.evaluatePromotion || evaluateGlobalLayoutPromotion)(contributions);
      const diversityEligible = promotion.metrics.supportCount >= 5
        && promotion.metrics.companyCount >= 3
        && promotion.metrics.maxCompanyShare <= 0.4;
      if (!diversityEligible) {
        await (dependencies.retireArtifacts || retireGlobalLayoutArtifacts)(identity, db);
        outcome = { status: "withheld", reasons: promotion.reasons };
      } else {
        const artifact = deterministicGlobalLayoutArtifact(contributions);
        const scan = scanGlobalLayoutPayload(artifact.payload, keyring);
        const createArtifact = dependencies.createArtifact || createGlobalLayoutArtifact;
        const created = await createArtifact({
          ...identity,
          markerDigests: artifact.markerDigests,
          templatePayload: artifact.payload,
          status: "shadow",
          supportCount: promotion.metrics.supportCount,
          companyCount: promotion.metrics.companyCount,
          maxCompanyShare: promotion.metrics.maxCompanyShare,
          criticalExactMatch: promotion.metrics.criticalExactMatch,
          totalsReconcileRate: promotion.metrics.totalsReconcileRate,
          falseMatchRate: promotion.metrics.falseMatchRate,
          privacyScannerVersion: scan.scannerVersion,
          privacyScanDigest: scan.scanDigest,
        }, db);
        if (!created) throw new Error("invoice_global_layout_hmac_unavailable");
        outcome = { status: "shadow", artifact: created, releaseBlockedReasons: promotion.reasons };
      }
    }
    await mark({ id: rebuild.id, status: "succeeded" }, db);
    const companies = await (dependencies.withdrawingCompanies || withdrawingCompaniesForArtifact)(identity, db);
    for (const companyId of companies) {
      await (dependencies.completeWithdrawal || completeGlobalLayoutWithdrawal)({ companyId }, db);
    }
    return outcome;
  });
}

export async function runNextGlobalLayoutRebuild(dependencies = {}) {
  const transact = dependencies.transaction || withGlobalLayoutTransaction;
  const rebuild = await transact((db) => (dependencies.claimRebuild || claimGlobalLayoutRebuild)(db));
  if (!rebuild) return null;
  try {
    return await rebuildGlobalLayout(rebuild, dependencies);
  } catch (error) {
    await (dependencies.markRebuild || markGlobalLayoutRebuild)({
      id: rebuild.id, status: "failed", errorCode: safeErrorCode(error),
    });
    throw error;
  }
}

export async function drainGlobalLayoutRebuilds({ maxJobs = 10, ...dependencies } = {}) {
  if (draining) return [];
  draining = true;
  const results = [];
  try {
    for (let index = 0; index < Math.min(50, Math.max(1, Number(maxJobs) || 10)); index += 1) {
      await runNextGlobalLayoutContribution(dependencies);
      const result = await runNextGlobalLayoutRebuild(dependencies);
      if (!result) break;
      results.push(result);
    }
    return results;
  } finally {
    draining = false;
  }
}

export function startGlobalLayoutLearningWorker({
  pollMs = Number(process.env.INVOICE_GLOBAL_LAYOUT_REBUILD_POLL_MS || DEFAULT_POLL_MS),
} = {}) {
  if (pollTimer) return;
  const intervalMs = Math.max(5_000, Number(pollMs) || DEFAULT_POLL_MS);
  const run = () => drainGlobalLayoutRebuilds().catch((error) => {
    console.warn(`Invoice global-layout rebuild failed: ${safeErrorCode(error)}`);
  });
  pollTimer = setInterval(run, intervalMs);
  pollTimer.unref?.();
  setTimeout(() => run(), 5_000).unref?.();
}

export function stopGlobalLayoutLearningWorker() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  draining = false;
}
