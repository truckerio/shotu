import { getPool, query } from "../pool.js";
import {
  createOperationalWorkorderInTransaction,
  getOperationalWorkorderById,
  mapActiveAssetConflict,
} from "./operational-workorders.repo.js";

export class WorkorderDraftConflictError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkorderDraftConflictError";
    this.code = code;
    this.statusCode = 409;
  }
}

export class WorkorderDraftLimitError extends Error {
  constructor(message = "You already have 25 active workorder drafts.") {
    super(message);
    this.name = "WorkorderDraftLimitError";
    this.code = "DRAFT_LIMIT_REACHED";
    this.statusCode = 409;
  }
}

export class WorkorderDraftPermissionError extends Error {
  constructor(message = "You do not have permission to take over this draft.") {
    super(message);
    this.name = "WorkorderDraftPermissionError";
    this.code = "DRAFT_PERMISSION_DENIED";
    this.statusCode = 403;
  }
}

export function publicWorkorderDraftRow(row) {
  if (!row) return null;
  const payload = row.payload || {};
  const formData = payload.formData || {};
  const unit = payload.unitNo || payload.unitNumber || formData.unitNo || formData.unitNumber || "";
  const concern = payload.concern || payload.mechanicConcern || formData.mechanicConcern || "";
  const missingFields = [];
  if (!row.location_id) missingFields.push("location");
  if (!unit) missingFields.push("unit");
  if (!String(concern).trim()) missingFields.push("mechanicConcern");
  const customer = payload.customerCompanyName || payload.companyName
    || formData.customerCompanyName || formData.companyName || "";
  if (!String(customer).trim()) missingFields.push("customerCompanyName");
  return {
    id: row.id,
    companyId: row.company_id,
    type: row.type,
    status: row.status,
    version: row.version,
    locationId: row.location_id,
    location: row.location_name ? { id: row.location_id, name: row.location_name } : null,
    unit: unit || null,
    concern: concern || null,
    missingFields,
    creator: row.creator_name ? { id: row.created_by_user_id, name: row.creator_name } : { id: row.created_by_user_id },
    owner: row.owner_name ? { id: row.owner_user_id, name: row.owner_name } : { id: row.owner_user_id },
    lastEditedBy: row.last_editor_name
      ? { id: row.last_edited_by_user_id, name: row.last_editor_name }
      : { id: row.last_edited_by_user_id },
    payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedWorkorderId: row.submitted_workorder_id,
  };
}

function draftSelect() {
  return `select d.*,
    location.name as location_name,
    creator.display_name as creator_name,
    owner.display_name as owner_name,
    editor.display_name as last_editor_name
  from workorder_drafts d
  left join locations location on location.id = d.location_id and location.company_id = d.company_id
  left join user_profiles creator on creator.id = d.created_by_user_id
  left join user_profiles owner on owner.id = d.owner_user_id
  left join user_profiles editor on editor.id = d.last_edited_by_user_id`;
}

function visibleScope({ companyIds, locationIds = [], userId, role }, start = 1, alias = "d") {
  const values = [companyIds?.length ? companyIds : []];
  const company = `${alias}.company_id = any($${start}::uuid[])`;
  if (role === "admin") return { sql: company, values };
  if (role === undefined && locationIds.length === 0) {
    values.push(userId);
    return {
      sql: `${company} and (
        ${alias}.created_by_user_id = $${start + 1}
        or ${alias}.owner_user_id = $${start + 1}
        or ${alias}.last_edited_by_user_id = $${start + 1}
      )`,
      values,
    };
  }
  values.push(locationIds?.length ? locationIds : [], userId);
  return {
    sql: `${company} and (
      ${alias}.location_id = any($${start + 1}::uuid[])
      or (${alias}.location_id is null and (
        ${alias}.created_by_user_id = $${start + 2}
        or ${alias}.owner_user_id = $${start + 2}
        or ${alias}.last_edited_by_user_id = $${start + 2}
      ))
    )`,
    values,
  };
}

function editableScope({ companyIds, locationIds = [], userId, role }, start = 1, alias = "d") {
  const visible = visibleScope({ companyIds, locationIds, userId, role }, start, alias);
  if (role === undefined && locationIds.length === 0) return visible;
  if (role === "admin") {
    visible.values.push(userId);
    return {
      sql: `${visible.sql} and ${alias}.owner_user_id = $${start + 1}`,
      values: visible.values,
    };
  }
  return {
    sql: `${visible.sql} and ${alias}.owner_user_id = $${start + 2}`,
    values: visible.values,
  };
}

function discardableScope({ companyIds, locationIds = [], userId, role }, start = 1, alias = "d") {
  if (role === "admin") return visibleScope({ companyIds, locationIds, userId, role }, start, alias);
  return editableScope({ companyIds, locationIds, userId, role }, start, alias);
}

async function recordDraftEvent({ draftId, companyId, actorUserId, action, version, details = {} }, client = null) {
  const db = client || { query };
  await db.query(
    `insert into workorder_draft_events (draft_id, company_id, actor_user_id, action, version, details)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [draftId, companyId, actorUserId || null, action, version, JSON.stringify(details)],
  );
}

export async function createWorkorderDraft({
  companyId,
  locationId,
  userId,
  type = "workorder",
  payload = {},
}) {
  const client = await getPool().connect();
  let draft;
  try {
    await client.query("begin");
    await client.query(
      "select pg_advisory_xact_lock(hashtext($1))",
      [`workorder-draft-limit:${userId}`],
    );
    const active = await client.query(
      `select count(*)::integer as count
         from workorder_drafts
        where owner_user_id = $1 and type = $2 and status = 'active'`,
      [userId, type],
    );
    if (active.rows[0].count >= 25) throw new WorkorderDraftLimitError();
    const result = await client.query(
      `insert into workorder_drafts (
         company_id, location_id, created_by_user_id, owner_user_id, last_edited_by_user_id, type, payload
       ) values ($1, $2, $3, $3, $3, $4, $5::jsonb)
       returning *`,
      [companyId, locationId, userId, type, JSON.stringify(payload)],
    );
    await recordDraftEvent({
      draftId: result.rows[0].id,
      companyId,
      actorUserId: userId,
      action: "created",
      version: result.rows[0].version,
    }, client);
    await client.query("commit");
    draft = result.rows[0];
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return publicWorkorderDraftRow(draft);
}

export async function listActiveWorkorderDrafts({ companyIds, locationIds, userId, role, type = "workorder" }) {
  const scope = visibleScope({ companyIds, locationIds, userId, role });
  const typeParam = scope.values.length + 1;
  const result = await query(
    `${draftSelect()}
      where ${scope.sql}
        and d.type = $${typeParam}
        and d.status = 'active'
      order by d.updated_at desc, d.id`,
    [...scope.values, type],
  );
  return result.rows.map(publicWorkorderDraftRow);
}

export async function getWorkorderDraftById({ id, companyIds, locationIds, userId, role }) {
  const scope = visibleScope({ companyIds, locationIds, userId, role }, 2);
  const result = await query(
    `${draftSelect()}
      where d.id = $1 and ${scope.sql}
      limit 1`,
    [id, ...scope.values],
  );
  return publicWorkorderDraftRow(result.rows[0]);
}

export async function getWorkorderDraftOwnership({ id, companyIds, locationIds, userId, role }) {
  const scope = editableScope({ companyIds, locationIds, userId, role }, 2);
  const result = await query(
    `select company_id, location_id, status
       from workorder_drafts d
      where d.id = $1 and ${scope.sql}
      limit 1`,
    [id, ...scope.values],
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
  locationIds,
  role,
  userId,
  version,
  locationId,
  payload,
}) {
  const scope = editableScope({ companyIds, locationIds, userId, role }, 2);
  const hasLocation = locationId !== undefined;
  const hasPayload = payload !== undefined;
  const versionParam = scope.values.length + 2;
  const editorParam = versionParam + 1;
  const locationFlagParam = versionParam + 2;
  const locationValueParam = versionParam + 3;
  const payloadFlagParam = versionParam + 4;
  const payloadValueParam = versionParam + 5;
  const result = await query(
    `update workorder_drafts as d
        set location_id = case when $${locationFlagParam}::boolean then $${locationValueParam}::uuid else d.location_id end,
            payload = case when $${payloadFlagParam}::boolean then d.payload || $${payloadValueParam}::jsonb else d.payload end,
            last_edited_by_user_id = $${editorParam},
            version = version + 1,
            updated_at = now()
      where d.id = $1
        and ${scope.sql}
        and d.status = 'active'
        and d.version = $${versionParam}
      returning *`,
    [
      id,
      ...scope.values,
      version,
      userId,
      hasLocation,
      hasLocation ? locationId : null,
      hasPayload,
      JSON.stringify(payload || {}),
    ],
  );
  if (result.rows[0]) {
    await recordDraftEvent({
      draftId: id,
      companyId: result.rows[0].company_id,
      actorUserId: userId,
      action: "updated",
      version: result.rows[0].version,
      details: { locationChanged: hasLocation, payloadChanged: hasPayload },
    });
    return publicWorkorderDraftRow(result.rows[0]);
  }

  const existing = await getWorkorderDraftById({ id, companyIds, locationIds, userId, role });
  if (!existing) return null;
  if (existing.status !== "active") {
    throw new WorkorderDraftConflictError("DRAFT_NOT_ACTIVE", "This draft is no longer active.");
  }
  throw new WorkorderDraftConflictError(
    "DRAFT_VERSION_CONFLICT",
    "This draft changed in another tab. Reload it before saving again.",
  );
}

export async function discardWorkorderDraft({ id, companyIds, locationIds, userId, role }) {
  const scope = discardableScope({ companyIds, locationIds, userId, role }, 2);
  const result = await query(
    `update workorder_drafts as d
        set status = 'discarded',
            version = version + 1,
            discarded_at = now(),
            updated_at = now()
      where d.id = $1
        and ${scope.sql}
        and d.status = 'active'
      returning id`,
    [id, ...scope.values],
  );
  if (result.rows[0]) {
    const draft = await getWorkorderDraftById({ id, companyIds, locationIds, userId, role });
    await recordDraftEvent({
      draftId: id,
      companyId: draft.companyId,
      actorUserId: userId,
      action: "discarded",
      version: draft.version,
    });
    return true;
  }

  const existing = await getWorkorderDraftById({ id, companyIds, locationIds, userId, role });
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
  locationIds,
  role,
  userId,
  version,
  prepareCreateInput,
}, client, dependencies = {}) {
  const createWorkorder = dependencies.createWorkorder || createOperationalWorkorderInTransaction;
  const scope = editableScope({ companyIds, locationIds, userId, role }, 2);
  const locked = await client.query(
    `select *
       from workorder_drafts d
      where d.id = $1 and ${scope.sql}
      for update`,
    [id, ...scope.values],
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
  let created;
  try {
    created = await createWorkorder(createInput, client);
  } catch (error) {
    throw mapActiveAssetConflict(error);
  }
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
  await recordDraftEvent({
    draftId: id,
    companyId: draftRow.company_id,
    actorUserId: userId,
    action: "submitted",
    version: submitted.rows[0].version,
    details: { workorderId: created.id },
  }, client);
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

export async function takeoverWorkorderDraft({ id, companyIds, locationIds, userId, role, version }) {
  if (role !== "admin") throw new WorkorderDraftPermissionError();
  const scope = visibleScope({ companyIds, locationIds, userId, role }, 2);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const locked = await client.query(
      `select d.*
         from workorder_drafts d
        where d.id = $1 and ${scope.sql}
        for update`,
      [id, ...scope.values],
    );
    const current = locked.rows[0];
    if (!current) {
      await client.query("rollback");
      return null;
    }
    if (current.status !== "active") {
      throw new WorkorderDraftConflictError("DRAFT_NOT_ACTIVE", "This draft is no longer active.");
    }
    if (version !== undefined && version !== current.version) {
      throw new WorkorderDraftConflictError(
        "DRAFT_VERSION_CONFLICT",
        "This draft changed in another tab. Reload it before taking it over.",
      );
    }
    const updated = await client.query(
      `update workorder_drafts
          set owner_user_id = $2,
              last_edited_by_user_id = $2,
              version = version + 1,
              updated_at = now()
        where id = $1 and status = 'active'
        returning *`,
      [id, userId],
    );
    await recordDraftEvent({
      draftId: id,
      companyId: current.company_id,
      actorUserId: userId,
      action: "taken_over",
      version: updated.rows[0].version,
      details: { previousOwnerUserId: current.owner_user_id },
    }, client);
    await client.query("commit");
    return publicWorkorderDraftRow(updated.rows[0]);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
