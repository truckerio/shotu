import crypto from "node:crypto";
import { getPool, query } from "../pool.js";
import { inspectionPrintSnapshotDigest, normalizeInspectionPrintSnapshot } from "../../modules/inspections/inspection-print-integrity.js";

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function archiveRow(row, { internal = false } = {}) {
  if (!row) return null;
  return {
    id: row.id, companyId: row.company_id, inspectionId: row.inspection_id,
    locationId: row.location_id, inspectionNumber: row.inspection_number,
    artifactKind: row.artifact_kind, revisionNumber: Number(row.revision_number),
    status: row.status, snapshot: row.snapshot, snapshotSha256: row.snapshot_sha256,
    documentSha256: row.pdf_sha256 || null, documentByteSize: row.pdf_byte_size == null ? null : Number(row.pdf_byte_size),
    createdAt: row.created_at, generatedAt: row.generated_at || null,
    ...(internal ? { storageKey: row.storage_key || null, pdfBytes:row.pdf_bytes || null, leaseToken: row.lease_token, leaseExpiresAt: row.lease_expires_at } : {}),
  };
}
function conflict(code, message) { const error = new Error(message); error.statusCode = 409; error.code = code; return error; }

export async function ensureInspectionPrintArchiveInTransaction(input, client) {
  const kind = input.predecessorArchiveId ? "revised" : "original";
  const snapshot = normalizeInspectionPrintSnapshot(input.snapshot);
  if (inspectionPrintSnapshotDigest(snapshot) !== input.snapshotSha256) throw conflict("INSPECTION_PRINT_ARCHIVE_DIGEST_MISMATCH", "Inspection print archive digest does not match its canonical snapshot.");
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${input.companyId}:${input.inspectionId}:${kind}`]);
  const existing = await client.query(`select * from inspection_print_archives
    where company_id=$1 and inspection_id=$2 order by revision_number desc limit 1 for update`, [input.companyId, input.inspectionId]);
  if (existing.rows[0]) return { archive: archiveRow(existing.rows[0]), replayed: true };
  const inserted = await client.query(`insert into inspection_print_archives(
      company_id,inspection_id,location_id,inspection_number,artifact_kind,revision_number,predecessor_archive_id,revision_reason,
      snapshot,snapshot_sha256,created_by_user_id,idempotency_key,request_sha256,lease_expires_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,now()) returning *`, [
    input.companyId, input.inspectionId, input.locationId, input.inspectionNumber, kind, input.revisionNumber || 1,
    input.predecessorArchiveId || null, input.revisionReason || "", JSON.stringify(snapshot), input.snapshotSha256,
    input.actorId, input.idempotencyKey, input.requestSha256,
  ]);
  return { archive: archiveRow(inserted.rows[0], { internal: true }), replayed: false };
}

export async function createInspectionPrintArchive(input, dependencies = {}) {
  const pool = dependencies.pool || getPool(); const client = await pool.connect();
  try {
    await client.query("begin");
    const replay = await client.query(`select * from inspection_print_archives
      where company_id=$1 and created_by_user_id=$2 and idempotency_key=$3 for update`, [input.companyId,input.actorId,input.idempotencyKey]);
    let ensured;
    if (replay.rows[0]) {
      if (replay.rows[0].request_sha256 !== input.requestSha256) throw conflict("INSPECTION_PRINT_IDEMPOTENCY_CONFLICT", "That idempotency key was already used for a different inspection print.");
      if (replay.rows[0].status === "ready") { await client.query("commit"); return { archive:archiveRow(replay.rows[0]), replayed:true, created:false }; }
      ensured = { archive:archiveRow(replay.rows[0]), replayed:true };
    } else {
      ensured = await ensureInspectionPrintArchiveInTransaction(input, client);
    }
    if (ensured.archive.status === "ready") { await client.query("commit"); return { archive: ensured.archive, replayed:true, created:false }; }
    const claimed = await client.query(`update inspection_print_archives
      set status='pending',attempt_number=attempt_number+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes'
      where company_id=$1 and id=$2 and (status='failed' or (status='pending' and lease_expires_at<=now())) returning *`, [input.companyId,ensured.archive.id]);
    await client.query("commit");
    if (!claimed.rows[0]) return { archive: ensured.archive, replayed:true, created:false };
    return { archive: archiveRow(claimed.rows[0], { internal:true }), replayed:false, created:true };
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

export async function completeInspectionPrintArchive(input, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(`update inspection_print_archives set status='ready',storage_key='db:inline-pdf',pdf_sha256=$4,pdf_byte_size=$5,pdf_bytes=$6,generated_at=now()
    where company_id=$1 and id=$2 and lease_token=$3 and status='pending' and lease_expires_at>now() returning *`,
  [input.companyId,input.archiveId,input.leaseToken,input.pdfSha256,input.pdfByteSize,input.pdfBytes]);
  if (!result.rows[0]) throw conflict("INSPECTION_PRINT_ARCHIVE_FINALIZE_CONFLICT", "Inspection PDF archive could not be finalized.");
  return archiveRow(result.rows[0]);
}

export async function failInspectionPrintArchive(input, dependencies = {}) {
  const run = dependencies.query || query;
  await run(`update inspection_print_archives set status='failed'
    where company_id=$1 and id=$2 and lease_token=$3 and status='pending'`, [input.companyId,input.archiveId,input.leaseToken]);
}

export async function findInspectionPrintArchive(input, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(`select * from inspection_print_archives where id=$1 and inspection_id=$2 and company_id=$3 limit 1`, [input.archiveId,input.inspectionId,input.companyId]);
  return archiveRow(result.rows[0], { internal:input.internal === true });
}

export async function findLatestInspectionPrintArchive(input, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(`select * from inspection_print_archives
    where inspection_id=$1 and company_id=$2 and status='ready'
    order by revision_number desc,created_at desc limit 1`, [input.inspectionId, input.companyId]);
  return archiveRow(result.rows[0]);
}

export async function recordInspectionPrintLegacyAcceptance(input, dependencies = {}) {
  const run = dependencies.query || query;
  await run(`insert into inspection_print_integrity_acceptances(
      company_id,inspection_id,archive_id,legacy_format,stored_snapshot_sha256,canonical_snapshot_sha256,accepted_by_user_id)
    values($1,$2,$3,$4,$5,$6,$7)
    on conflict(company_id,archive_id,legacy_format) do nothing`, [
    input.companyId,input.inspectionId,input.archiveId,input.legacyFormat,input.storedSnapshotSha256,input.canonicalSnapshotSha256,input.actorId,
  ]);
}

export const inspectionPrintArchiveInternals = { sha256, archiveRow };
