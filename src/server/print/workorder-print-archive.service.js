import crypto from "node:crypto";
import { relative, resolve } from "node:path";
import { AuthError, invalidRequest, resourceNotFound } from "../auth/errors.js";
import {
  claimWorkorderPrintArchive,
  completeWorkorderPrintArchive,
  failWorkorderPrintArchive,
  findLatestScopedWorkorderPrintArchive,
  findScopedWorkorderPrintArchive,
  listScopedWorkorderPrintArchives,
} from "../db/repositories/workorder-print-archives.repo.js";
import { withLockedWorkorderPrintSnapshot } from "../db/repositories/workorder-print-snapshot.repo.js";

const PRINT_LEASE_SECONDS = 120;

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function containedStoragePath(root, storageKey) {
  if (!storageKey || String(storageKey).includes("\0")) return null;
  const candidate = resolve(root, storageKey);
  const rel = relative(resolve(root), candidate);
  return rel && !rel.startsWith("..") && !rel.includes("\0") ? candidate : null;
}

function archiveConflict(error) {
  const messages = {
    PRINT_IDEMPOTENCY_CONFLICT: "That idempotency key was already used for a different print request.",
    PRINT_ORIGINAL_EXISTS: "The original is immutable. Create a revision instead.",
    PRINT_REVISION_PREDECESSOR_INVALID: "A revision must name the latest ready archive as its predecessor.",
    PRINT_ARCHIVE_FINALIZE_CONFLICT: "The print archive could not be finalized.",
  };
  if (!messages[error?.code]) return error;
  return new AuthError(409, error.code, messages[error.code]);
}

function parseRequest(input) {
  const artifactKind = input.artifactKind || "original";
  if (!input.workorderId) throw invalidRequest("Create the workorder before printing.");
  if (!['original', 'revised'].includes(artifactKind)) throw invalidRequest("artifactKind must be original or revised.");
  const revisionReason = String(input.revisionReason || "").trim();
  if (artifactKind === "revised" && (!input.predecessorArchiveId || !revisionReason)) {
    throw invalidRequest("Revisions require a predecessorArchiveId and revisionReason.");
  }
  if (artifactKind === "original" && (input.predecessorArchiveId || revisionReason)) {
    throw invalidRequest("Original prints cannot name a predecessor or revision reason.");
  }
  if (revisionReason.length > 1000) throw invalidRequest("revisionReason is too long.");
  const suppliedKey = String(input.idempotencyKey || "").trim();
  if (!suppliedKey) throw invalidRequest("idempotencyKey is required.");
  if (suppliedKey.length < 8 || suppliedKey.length > 120) {
    throw invalidRequest("idempotencyKey must be between 8 and 120 characters.");
  }
  const copyCount = Number(input.count);
  if (!Number.isInteger(copyCount) || copyCount < 1 || copyCount > 250) {
    throw invalidRequest("count must be an integer between 1 and 250.");
  }
  return { artifactKind, revisionReason, predecessorArchiveId: input.predecessorArchiveId || null, idempotencyKey: suppliedKey, copyCount };
}

export async function createArchivedWorkorderPrint(input, context, dependencies) {
  const parsed = parseRequest(input);
  const source = await (dependencies.withSnapshotLock || withLockedWorkorderPrintSnapshot)({
    workorderId: input.workorderId,
    companyIds: [...(context.companyIds || [])],
  }, async () => {
    const workorder = await dependencies.requireWorkorderAccess(context, input.workorderId, {
      requireLocationMembership: true,
    });
    if (!workorder.locationId) throw invalidRequest("The workorder must have a location before printing.");
    return { workorder, form: await dependencies.buildPrintForm(workorder) };
  });
  if (!source) throw resourceNotFound("Workorder");
  const { workorder } = source;
  let { form } = source;
  if (parsed.artifactKind === "revised") {
    form = { ...form, headerTitle: `REVISED — ${form.headerTitle || "WORK ORDER"}` };
  }
  const snapshot = {
    schemaVersion: 1,
    workorderId: workorder.id,
    companyId: workorder.companyId,
    locationId: workorder.locationId,
    workorderSerial: workorder.serial,
    artifactKind: parsed.artifactKind,
    predecessorArchiveId: parsed.predecessorArchiveId,
    revisionReason: parsed.revisionReason,
    copyCount: parsed.copyCount,
    form,
  };
  const snapshotJson = JSON.stringify(snapshot);
  const requestSha256 = sha256(JSON.stringify({ snapshot, actorId: context.actor.id }));
  let claim;
  try {
    claim = await (dependencies.claimArchive || claimWorkorderPrintArchive)({
      companyId: workorder.companyId, workorderId: workorder.id, locationId: workorder.locationId,
      workorderSerial: workorder.serial, actorId: context.actor.id, idempotencyKey: parsed.idempotencyKey,
      requestSha256, snapshotSha256: sha256(snapshotJson), snapshot,
      artifactKind: parsed.artifactKind, predecessorArchiveId: parsed.predecessorArchiveId,
      revisionReason: parsed.revisionReason,
      leaseSeconds: dependencies.leaseSeconds || PRINT_LEASE_SECONDS,
    });
  } catch (error) {
    throw archiveConflict(error);
  }
  if (!claim.created) {
    if (claim.archive.status !== "ready") throw new AuthError(409, "PRINT_ARCHIVE_NOT_READY", "The matching print archive is not ready.");
    return { archive: claim.archive, form, replayed: true };
  }
  try {
    const filePath = await dependencies.writePdf(form, workorder, claim.archive, parsed.copyCount);
    const bytes = await dependencies.readFile(filePath);
    const storageKey = relative(resolve(dependencies.outputDir), resolve(filePath));
    if (!containedStoragePath(dependencies.outputDir, storageKey)) throw new Error("Generated PDF escaped the archive root.");
    let archive;
    try {
      archive = await (dependencies.completeArchive || completeWorkorderPrintArchive)({
      companyId: workorder.companyId, archiveId: claim.archive.id, actorId: context.actor.id,
      leaseToken: claim.archive.leaseToken,
      storageKey, pdfSha256: sha256(bytes), pdfByteSize: bytes.byteLength,
      });
    } catch (error) {
      throw archiveConflict(error);
    }
    return { archive, form, replayed: false };
  } catch (error) {
    await (dependencies.failArchive || failWorkorderPrintArchive)({
      companyId: workorder.companyId, archiveId: claim.archive.id, actorId: context.actor.id,
      leaseToken: claim.archive.leaseToken,
    });
    throw error;
  }
}

export async function readArchivedPdf(archiveId, context, dependencies) {
  const archive = await (dependencies.findArchive || findScopedWorkorderPrintArchive)({
    archiveId,
    companyIds: [...(context.companyIds || [])],
    locationIds: [...(context.locationIds || [])],
    isAdmin: context.actor.role === "admin",
  });
  if (!archive) throw resourceNotFound("Print job");
  await dependencies.requireWorkorderAccess(context, archive.workorderId, { requireLocationMembership: true });
  if (archive.status !== "ready") throw new AuthError(409, "PRINT_ARCHIVE_INTEGRITY_FAILURE", "The archived PDF is unavailable or failed integrity verification.");
  const filePath = containedStoragePath(dependencies.outputDir, archive.storageKey);
  if (!filePath) throw new AuthError(409, "PRINT_ARCHIVE_INTEGRITY_FAILURE", "The archived PDF is unavailable or failed integrity verification.");
  let bytes;
  try {
    bytes = await dependencies.readFile(filePath);
  } catch {
    throw new AuthError(409, "PRINT_ARCHIVE_INTEGRITY_FAILURE", "The archived PDF is unavailable or failed integrity verification.");
  }
  if (bytes.byteLength !== archive.pdfByteSize || sha256(bytes) !== archive.pdfSha256) {
    throw new AuthError(409, "PRINT_ARCHIVE_INTEGRITY_FAILURE", "The archived PDF is unavailable or failed integrity verification.");
  }
  return { archive: { ...archive, storageKey: undefined }, bytes, fileName: `${archive.workorderSerial}${archive.artifactKind === "revised" ? `_R${archive.revisionNumber}` : ""}.pdf` };
}

export async function findArchivedPrintForWorkorder(workorderId, artifactKind, context, dependencies) {
  if (!['original', 'revised'].includes(artifactKind)) throw invalidRequest("artifactKind must be original or revised.");
  await dependencies.requireWorkorderAccess(context, workorderId, { requireLocationMembership: true });
  const archive = await (dependencies.findLatestArchive || findLatestScopedWorkorderPrintArchive)({
    workorderId,
    artifactKind,
    companyIds: [...(context.companyIds || [])],
    locationIds: [...(context.locationIds || [])],
    isAdmin: context.actor.role === "admin",
  });
  if (!archive) return null;
  const { snapshot: _snapshot, ...summary } = archive;
  return {
    ...summary,
    copyCount: archive.snapshot?.copyCount,
    serials: [archive.workorderSerial],
    downloadUrl: `/api/jobs/${encodeURIComponent(archive.id)}/pdf`,
  };
}

export async function listArchivedPrints(context, dependencies = {}) {
  const rows = await (dependencies.listArchives || listScopedWorkorderPrintArchives)({
    companyIds: [...(context.companyIds || [])],
    locationIds: [...(context.locationIds || [])],
    isAdmin: context.actor.role === "admin",
    limit: dependencies.limit || 50,
  });
  return rows.map((archive) => {
    const { snapshot: _snapshot, ...summary } = archive;
    return {
      ...summary,
      copyCount: archive.snapshot?.copyCount,
      serials: [archive.workorderSerial],
      downloadUrl: archive.status === "ready" ? `/api/jobs/${encodeURIComponent(archive.id)}/pdf` : null,
    };
  });
}
