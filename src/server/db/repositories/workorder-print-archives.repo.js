import { getPool, query } from "../pool.js";

function archiveRow(row, { internal = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    workorderId: row.workorder_id,
    locationId: row.location_id,
    workorderSerial: row.workorder_serial,
    artifactKind: row.artifact_kind,
    revisionNumber: Number(row.revision_number),
    predecessorArchiveId: row.predecessor_archive_id || null,
    revisionReason: row.revision_reason,
    snapshot: row.snapshot,
    snapshotSha256: row.snapshot_sha256,
    pdfSha256: row.pdf_sha256 || null,
    pdfByteSize: row.pdf_byte_size == null ? null : Number(row.pdf_byte_size),
    status: row.status,
    attemptNumber: Number(row.attempt_number),
    leaseExpiresAt: row.lease_expires_at,
    lastAttemptStartedAt: row.last_attempt_started_at,
    createdAt: row.created_at,
    generatedAt: row.generated_at || null,
    ...(internal ? { storageKey: row.storage_key || null, leaseToken: row.lease_token } : {}),
  };
}

function conflict(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export async function claimWorkorderPrintArchive(input, dependencies = {}) {
  const pool = dependencies.pool || getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${input.companyId}:${input.workorderId}`]);
    const replay = await client.query(
      `select *, lease_expires_at <= now() as lease_expired from workorder_print_archives
       where company_id = $1 and created_by_user_id = $2 and idempotency_key = $3
       for update`,
      [input.companyId, input.actorId, input.idempotencyKey],
    );
    if (replay.rows[0]) {
      if (replay.rows[0].request_sha256 !== input.requestSha256) throw conflict("PRINT_IDEMPOTENCY_CONFLICT");
      const reclaimable = replay.rows[0].status === "failed"
        || (replay.rows[0].status === "pending" && replay.rows[0].lease_expired);
      if (reclaimable) {
        const retried = await client.query(
          `update workorder_print_archives set status = 'pending', storage_key = null,
             pdf_sha256 = null, pdf_byte_size = null, generated_at = null,
             attempt_number = attempt_number + 1, lease_token = gen_random_uuid(),
             lease_expires_at = now() + make_interval(secs => $3), last_attempt_started_at = now()
           where company_id = $1 and id = $2 returning *`,
          [input.companyId, replay.rows[0].id, input.leaseSeconds],
        );
        await client.query("commit");
        return { archive: archiveRow(retried.rows[0], { internal: true }), created: true };
      }
      await client.query("commit");
      return { archive: archiveRow(replay.rows[0]), created: false };
    }

    const latestResult = await client.query(
      `select * from workorder_print_archives
       where company_id = $1 and workorder_id = $2
       order by revision_number desc limit 1 for update`,
      [input.companyId, input.workorderId],
    );
    const latest = latestResult.rows[0] || null;
    let revisionNumber = 1;
    if (input.artifactKind === "original") {
      if (latest) throw conflict("PRINT_ORIGINAL_EXISTS");
    } else {
      if (!latest || latest.id !== input.predecessorArchiveId || latest.location_id !== input.locationId || latest.status !== "ready") {
        throw conflict("PRINT_REVISION_PREDECESSOR_INVALID");
      }
      revisionNumber = Number(latest.revision_number) + 1;
    }

    const inserted = await client.query(
      `insert into workorder_print_archives (
         company_id, workorder_id, location_id, workorder_serial, artifact_kind,
         revision_number, predecessor_archive_id, revision_reason, snapshot,
         snapshot_sha256, created_by_user_id, idempotency_key, request_sha256,
         lease_expires_at, last_attempt_started_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,
         now() + make_interval(secs => $14), now())
       returning *`,
      [input.companyId, input.workorderId, input.locationId, input.workorderSerial,
        input.artifactKind, revisionNumber, input.predecessorArchiveId, input.revisionReason,
        JSON.stringify(input.snapshot), input.snapshotSha256, input.actorId,
        input.idempotencyKey, input.requestSha256, input.leaseSeconds],
    );
    await client.query("commit");
    return { archive: archiveRow(inserted.rows[0], { internal: true }), created: true };
  } catch (error) {
    await client.query("rollback");
    if (error?.constraint === "workorder_print_archive_actor_idempotency_key") {
      throw conflict("PRINT_IDEMPOTENCY_CONFLICT");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function completeWorkorderPrintArchive(input, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(
    `update workorder_print_archives set status = 'ready', storage_key = $5,
       pdf_sha256 = $6, pdf_byte_size = $7, generated_at = now()
     where company_id = $1 and id = $2 and created_by_user_id = $3
       and lease_token = $4 and lease_expires_at > now() and status = 'pending'
     returning *`,
    [input.companyId, input.archiveId, input.actorId, input.leaseToken,
      input.storageKey, input.pdfSha256, input.pdfByteSize],
  );
  if (!result.rows[0]) throw conflict("PRINT_ARCHIVE_FINALIZE_CONFLICT");
  return archiveRow(result.rows[0]);
}

export async function failWorkorderPrintArchive(input, dependencies = {}) {
  const run = dependencies.query || query;
  await run(
    `update workorder_print_archives set status = 'failed'
     where company_id = $1 and id = $2 and created_by_user_id = $3
       and lease_token = $4 and status = 'pending'`,
    [input.companyId, input.archiveId, input.actorId, input.leaseToken],
  );
}

export async function findScopedWorkorderPrintArchive(input, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(
    `select * from workorder_print_archives
     where id = $1 and company_id = any($2::uuid[])
       and ($3::boolean or location_id = any($4::uuid[]))
     limit 1`,
    [input.archiveId, input.companyIds, input.isAdmin, input.locationIds],
  );
  return archiveRow(result.rows[0], { internal: true });
}

export async function listScopedWorkorderPrintArchives(input, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(
    `select * from workorder_print_archives
     where company_id = any($1::uuid[])
       and ($2::boolean or location_id = any($3::uuid[]))
     order by created_at desc, id desc limit $4`,
    [input.companyIds, input.isAdmin, input.locationIds, Math.min(Math.max(input.limit || 50, 1), 100)],
  );
  return result.rows.map((row) => archiveRow(row));
}

export async function findLatestScopedWorkorderPrintArchive(input, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(
    `select * from workorder_print_archives
     where workorder_id = $1 and artifact_kind = $2 and status = 'ready'
       and company_id = any($3::uuid[])
       and ($4::boolean or location_id = any($5::uuid[]))
     order by revision_number desc, created_at desc, id desc limit 1`,
    [input.workorderId, input.artifactKind, input.companyIds, input.isAdmin, input.locationIds],
  );
  return archiveRow(result.rows[0]);
}
