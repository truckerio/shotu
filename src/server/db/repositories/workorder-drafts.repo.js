import { getPool, query } from "../pool.js";
import {
  createOperationalWorkorderInTransaction,
  getOperationalWorkorderById,
} from "./operational-workorders.repo.js";

export class WorkorderDraftConflictError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkorderDraftConflictError";
    this.code = code;
    this.statusCode = 409;
  }
}

export function publicWorkorderDraftRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    version: row.version,
    locationId: row.location_id,
    payload: row.payload || {},
    updatedAt: row.updated_at,
    submittedWorkorderId: row.submitted_workorder_id,
  };
}

function scopeValues({ companyIds, userId }) {
  return [
    companyIds?.length ? companyIds : [],
    userId,
  ];
}

export async function createWorkorderDraft({
  companyId,
  locationId,
  userId,
  type = "workorder",
  payload = {},
}) {
  const result = await query(
    `insert into workorder_drafts (
       company_id, location_id, created_by_user_id, type, payload
     ) values ($1, $2, $3, $4, $5::jsonb)
     returning *`,
    [companyId, locationId, userId, type, JSON.stringify(payload)],
  );
  return publicWorkorderDraftRow(result.rows[0]);
}

export async function listActiveWorkorderDrafts({ companyIds, userId, type = "workorder" }) {
  const result = await query(
    `select *
       from workorder_drafts
      where company_id = any($1::uuid[])
        and created_by_user_id = $2
        and type = $3
        and status = 'active'
      order by updated_at desc, id`,
    [...scopeValues({ companyIds, userId }), type],
  );
  return result.rows.map(publicWorkorderDraftRow);
}

export async function getWorkorderDraftById({ id, companyIds, userId }) {
  const result = await query(
    `select *
       from workorder_drafts
      where id = $1
        and company_id = any($2::uuid[])
        and created_by_user_id = $3
      limit 1`,
    [id, ...scopeValues({ companyIds, userId })],
  );
  return publicWorkorderDraftRow(result.rows[0]);
}

export async function getWorkorderDraftOwnership({ id, companyIds, userId }) {
  const result = await query(
    `select company_id, location_id, status
       from workorder_drafts
      where id = $1
        and company_id = any($2::uuid[])
        and created_by_user_id = $3
      limit 1`,
    [id, ...scopeValues({ companyIds, userId })],
  );
  if (!result.rows[0]) return null;
  return {
    companyId: result.rows[0].company_id,
    locationId: result.rows[0].location_id,
    status: result.rows[0].status,
  };
}

export async function updateWorkorderDraft({
  id,
  companyIds,
  userId,
  version,
  locationId,
  payload,
}) {
  const hasLocation = locationId !== undefined;
  const hasPayload = payload !== undefined;
  const result = await query(
    `update workorder_drafts
        set location_id = case when $5::boolean then $6::uuid else location_id end,
            payload = case when $7::boolean then payload || $8::jsonb else payload end,
            version = version + 1,
            updated_at = now()
      where id = $1
        and company_id = any($2::uuid[])
        and created_by_user_id = $3
        and status = 'active'
        and version = $4
      returning *`,
    [
      id,
      companyIds?.length ? companyIds : [],
      userId,
      version,
      hasLocation,
      hasLocation ? locationId : null,
      hasPayload,
      JSON.stringify(payload || {}),
    ],
  );
  if (result.rows[0]) return publicWorkorderDraftRow(result.rows[0]);

  const existing = await getWorkorderDraftById({ id, companyIds, userId });
  if (!existing) return null;
  if (existing.status !== "active") {
    throw new WorkorderDraftConflictError("DRAFT_NOT_ACTIVE", "This draft is no longer active.");
  }
  throw new WorkorderDraftConflictError(
    "DRAFT_VERSION_CONFLICT",
    "This draft changed in another tab. Reload it before saving again.",
  );
}

export async function discardWorkorderDraft({ id, companyIds, userId }) {
  const result = await query(
    `update workorder_drafts
        set status = 'discarded',
            version = version + 1,
            discarded_at = now(),
            updated_at = now()
      where id = $1
        and company_id = any($2::uuid[])
        and created_by_user_id = $3
        and status = 'active'
      returning id`,
    [id, ...scopeValues({ companyIds, userId })],
  );
  if (result.rows[0]) return true;

  const existing = await getWorkorderDraftById({ id, companyIds, userId });
  if (!existing) return null;
  if (existing.status === "discarded") return true;
  throw new WorkorderDraftConflictError(
    "DRAFT_ALREADY_SUBMITTED",
    "A submitted draft cannot be discarded.",
  );
}

export async function submitWorkorderDraftInTransaction({
  id,
  companyIds,
  userId,
  version,
  prepareCreateInput,
}, client, dependencies = {}) {
  const createWorkorder = dependencies.createWorkorder || createOperationalWorkorderInTransaction;
  const locked = await client.query(
    `select *
       from workorder_drafts
      where id = $1
        and company_id = any($2::uuid[])
        and created_by_user_id = $3
      for update`,
    [id, ...scopeValues({ companyIds, userId })],
  );
  const draftRow = locked.rows[0];
  if (!draftRow) return null;

  if (draftRow.status === "submitted") {
    return {
      draft: publicWorkorderDraftRow(draftRow),
      workorderId: draftRow.submitted_workorder_id,
      idempotent: true,
    };
  }
  if (draftRow.status !== "active") {
    throw new WorkorderDraftConflictError("DRAFT_NOT_ACTIVE", "This draft is no longer active.");
  }
  if (version !== undefined && version !== draftRow.version) {
    throw new WorkorderDraftConflictError(
      "DRAFT_VERSION_CONFLICT",
      "This draft changed in another tab. Reload it before submitting.",
    );
  }

  const createInput = await prepareCreateInput({
    ...publicWorkorderDraftRow(draftRow),
    companyId: draftRow.company_id,
    createdByUserId: draftRow.created_by_user_id,
  });
  const created = await createWorkorder(createInput, client);
  const submitted = await client.query(
    `update workorder_drafts
        set status = 'submitted',
            version = version + 1,
            submitted_workorder_id = $2,
            submitted_at = now(),
            updated_at = now()
      where id = $1 and status = 'active'
      returning *`,
    [id, created.id],
  );
  if (!submitted.rows[0]) {
    throw new WorkorderDraftConflictError("DRAFT_NOT_ACTIVE", "This draft is no longer active.");
  }
  return {
    draft: publicWorkorderDraftRow(submitted.rows[0]),
    workorderId: created.id,
    idempotent: false,
  };
}

export async function submitWorkorderDraft(input) {
  const client = await getPool().connect();
  let result;
  let committed = false;
  try {
    await client.query("begin");
    result = await submitWorkorderDraftInTransaction(input, client);
    if (!result) {
      await client.query("rollback");
      return null;
    }
    await client.query("commit");
    committed = true;
  } catch (error) {
    if (!committed) await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return {
    draft: result.draft,
    workorder: await getOperationalWorkorderById(result.workorderId),
    idempotent: result.idempotent,
  };
}
