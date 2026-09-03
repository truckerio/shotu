import crypto from "node:crypto";
import { getPool, query } from "../pool.js";

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function archiveRow(row) {
  if (!row) return null;
  return {
    id: row.id, companyId: row.company_id, inspectionId: row.inspection_id,
    locationId: row.location_id, inspectionNumber: row.inspection_number,
    artifactKind: row.artifact_kind, revisionNumber: Number(row.revision_number),
    status: row.status, snapshot: row.snapshot, snapshotSha256: row.snapshot_sha256,
    documentSha256: row.pdf_sha256 || null, documentByteSize: row.pdf_byte_size == null ? null : Number(row.pdf_byte_size),
    createdAt: row.created_at, generatedAt: row.generated_at || null,
  };
}
function conflict(code, message) { const error = new Error(message); error.statusCode = 409; error.code = code; return error; }

export async function ensureInspectionPrintArchiveInTransaction(input, client) {
  const kind = input.predecessorArchiveId ? "revised" : "original";
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${input.companyId}:${input.inspectionId}:${kind}`]);
  const existing = await client.query(`select * from inspection_print_archives
    where company_id=$1 and inspection_id=$2 order by revision_number desc limit 1 for update`, [input.companyId, input.inspectionId]);
  if (existing.rows[0]) return { archive: archiveRow(existing.rows[0]), replayed: true };
  const inserted = await client.query(`insert into inspection_print_archives(
      company_id,inspection_id,location_id,inspection_number,artifact_kind,revision_number,predecessor_archive_id,revision_reason,
      snapshot,snapshot_sha256,pdf_sha256,pdf_byte_size,storage_key,status,
      created_by_user_id,idempotency_key,request_sha256,generated_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,'inline:snapshot','ready',$13,$14,$15,now()) returning *`, [
    input.companyId, input.inspectionId, input.locationId, input.inspectionNumber, kind, input.revisionNumber || 1,
    input.predecessorArchiveId || null, input.revisionReason || "", JSON.stringify(input.snapshot), input.snapshotSha256,
    input.documentSha256, input.documentByteSize, input.actorId, input.idempotencyKey, input.requestSha256,
  ]);
  return { archive: archiveRow(inserted.rows[0]), replayed: false };
}

export async function createInspectionPrintArchive(input, dependencies = {}) {
  const pool = dependencies.pool || getPool(); const client = await pool.connect();
  try {
    await client.query("begin");
    const replay = await client.query(`select * from inspection_print_archives
      where company_id=$1 and created_by_user_id=$2 and idempotency_key=$3 for update`, [input.companyId,input.actorId,input.idempotencyKey]);
    if (replay.rows[0]) {
      if (replay.rows[0].request_sha256 !== input.requestSha256) throw conflict("INSPECTION_PRINT_IDEMPOTENCY_CONFLICT", "That idempotency key was already used for a different inspection print.");
      await client.query("commit"); return { archive: archiveRow(replay.rows[0]), replayed: true };
    }
    const created = await ensureInspectionPrintArchiveInTransaction(input, client);
    await client.query("commit"); return created;
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

export async function findInspectionPrintArchive(input, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(`select * from inspection_print_archives where id=$1 and inspection_id=$2 and company_id=$3 limit 1`, [input.archiveId,input.inspectionId,input.companyId]);
  return archiveRow(result.rows[0]);
}

export async function findLatestInspectionPrintArchive(input, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(`select * from inspection_print_archives
    where inspection_id=$1 and company_id=$2 and status='ready'
    order by revision_number desc,created_at desc limit 1`, [input.inspectionId, input.companyId]);
  return archiveRow(result.rows[0]);
}

export const inspectionPrintArchiveInternals = { sha256, archiveRow };
