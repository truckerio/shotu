import { getPool, query } from "../pool.js";

const AMENDABLE_STATUSES = new Set(["open", "accepted", "in_progress", "mechanic_done"]);

function publicAmendment(row) {
  if (!row?.amendment_id) return null;
  return {
    id: row.amendment_id,
    action: row.amendment_action,
    replacementPart: row.replacement_part || null,
    reason: row.amendment_reason,
    actorId: row.amendment_actor_id,
    createdAt: row.amendment_created_at,
    supersedesAmendmentId: row.supersedes_amendment_id || null,
  };
}

function publicEvidence(row) {
  if (!row) return null;
  const latestAmendment = publicAmendment(row);
  return {
    evidenceId: row.evidence_id,
    workorderId: row.workorder_id,
    sourceOrdinal: Number(row.source_ordinal),
    originalPart: row.original_part,
    originalHash: row.original_hash,
    latestAmendment,
    effectivePart: latestAmendment?.action === "voided"
      ? null
      : latestAmendment?.replacementPart || row.original_part,
  };
}

export function applyManualPartEvidence(parts, evidenceRows) {
  const evidence = Array.isArray(evidenceRows) ? evidenceRows : [];
  const byId = new Map(evidence.map((row) => [String(row.evidenceId || ""), row]));
  const byOrdinal = new Map(evidence.map((row) => [Number(row.sourceOrdinal), row]));
  return (Array.isArray(parts) ? parts : []).flatMap((part, index) => {
    const row = byId.get(String(part?.evidenceId || "")) || byOrdinal.get(index);
    if (!row) return [part];
    if (!row.effectivePart) return [];
    return [{ ...row.effectivePart, evidenceId: row.evidenceId }];
  });
}

const EVIDENCE_SELECT = `
  select evidence.*,
         amendment.id as amendment_id,
         amendment.action as amendment_action,
         amendment.replacement_part,
         amendment.reason as amendment_reason,
         amendment.actor_id as amendment_actor_id,
         amendment.created_at as amendment_created_at,
         amendment.supersedes_amendment_id
  from workorder_manual_part_evidence evidence
  left join lateral (
    select candidate.*
    from workorder_manual_part_amendments candidate
    where candidate.company_id=evidence.company_id
      and candidate.evidence_id=evidence.evidence_id
      and not exists (
        select 1 from workorder_manual_part_amendments successor
        where successor.supersedes_amendment_id=candidate.id
      )
    order by candidate.created_at desc, candidate.id desc
    limit 1
  ) amendment on true`;

async function readWorkorderManualPartEvidence(runQuery, {
  workorderId,
  companyId,
  locationId,
  limit = 100,
}) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 2000));
  const result = await runQuery(
    `${EVIDENCE_SELECT}
     join operational_workorders workorder
       on workorder.company_id=evidence.company_id and workorder.id=evidence.workorder_id
     where evidence.company_id=$1 and evidence.workorder_id=$2
       and workorder.location_id=$3
     order by evidence.source_ordinal, evidence.evidence_id
     limit $4`,
    [companyId, workorderId, locationId, boundedLimit],
  );
  return result.rows.map(publicEvidence);
}

export async function listWorkorderManualPartEvidence(input) {
  return readWorkorderManualPartEvidence((text, values) => query(text, values), {
    ...input,
    limit: Math.max(1, Math.min(Number(input.limit) || 100, 200)),
  });
}

export async function listLockedWorkorderManualPartEvidence(client, input) {
  return readWorkorderManualPartEvidence((text, values) => client.query(text, values), input);
}

export async function amendWorkorderManualPartEvidence(input) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `manual-part-amendment:${input.actorId}:${input.idempotencyKey}`,
    ]);
    const replay = await client.query(
      `select id, request_hash, original_hash, supersedes_amendment_id, created_at
       from workorder_manual_part_amendments
       where company_id=any($1::uuid[]) and actor_id=$2 and idempotency_key=$3
       limit 1`,
      [input.companyIds, input.actorId, input.idempotencyKey],
    );
    if (replay.rows[0]) {
      await client.query("commit");
      return replay.rows[0].request_hash === input.requestHash
        ? {
          kind: "replay",
          amendmentId: replay.rows[0].id,
          createdAt: replay.rows[0].created_at,
          originalHash: replay.rows[0].original_hash,
          supersedesAmendmentId: replay.rows[0].supersedes_amendment_id || null,
        }
        : { kind: "idempotency_conflict" };
    }

    const selected = await client.query(
      `select evidence.*, workorder.status, workorder.location_id
       from workorder_manual_part_evidence evidence
       join operational_workorders workorder
         on workorder.company_id=evidence.company_id and workorder.id=evidence.workorder_id
       where evidence.evidence_id=$1 and evidence.workorder_id=$2
         and evidence.company_id=any($3::uuid[])
         and ($5::boolean or workorder.location_id=any($4::uuid[]))
       limit 1 for update of evidence, workorder`,
      [input.evidenceId, input.workorderId, input.companyIds, input.locationIds, input.isAdmin],
    );
    const evidence = selected.rows[0];
    if (!evidence) {
      await client.query("rollback");
      return { kind: "not_found" };
    }
    if (!AMENDABLE_STATUSES.has(evidence.status)) {
      await client.query("rollback");
      return { kind: "workorder_state" };
    }

    const latest = await client.query(
      `select candidate.id
       from workorder_manual_part_amendments candidate
       where candidate.company_id=$1 and candidate.evidence_id=$2
         and not exists (
           select 1 from workorder_manual_part_amendments successor
           where successor.supersedes_amendment_id=candidate.id
         )
       order by candidate.created_at desc, candidate.id desc
       limit 1`,
      [evidence.company_id, evidence.evidence_id],
    );
    const inserted = await client.query(
      `insert into workorder_manual_part_amendments (
         company_id, workorder_id, evidence_id, supersedes_amendment_id,
         action, replacement_part, reason, original_hash, actor_id,
         idempotency_key, request_hash
       ) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)
       returning id, created_at`,
      [
        evidence.company_id,
        evidence.workorder_id,
        evidence.evidence_id,
        latest.rows[0]?.id || null,
        input.action,
        input.replacementPart ? JSON.stringify(input.replacementPart) : null,
        input.reason,
        evidence.original_hash,
        input.actorId,
        input.idempotencyKey,
        input.requestHash,
      ],
    );
    await client.query("commit");
    return {
      kind: "amended",
      amendmentId: inserted.rows[0].id,
      createdAt: inserted.rows[0].created_at,
      originalHash: evidence.original_hash,
      supersedesAmendmentId: latest.rows[0]?.id || null,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export const manualPartEvidenceInternals = { AMENDABLE_STATUSES };
