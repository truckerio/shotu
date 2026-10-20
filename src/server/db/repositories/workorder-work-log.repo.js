import { createHash } from "node:crypto";
import { getPool } from "../pool.js";
import { assertCurrentExternalEstimateAccepted } from "./workorder-customer-authorization.repo.js";

export const WORK_LOG_STATUSES = Object.freeze([
  "ready", "active", "on_hold", "waiting_parts", "waiting_office",
]);

export class WorkLogConflictError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkLogConflictError";
    this.statusCode = 409;
    this.code = code;
  }
}

function requestHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hours(minutes) {
  return Number((Number(minutes) / 60).toFixed(2));
}

function dateValue(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

async function assertAssignedMechanic(client, workorderId, mechanicUserId) {
  if (!mechanicUserId) return;
  const assignment = await client.query(
    `select 1 from workorder_mechanic_assignments
     where workorder_id = $1 and mechanic_user_id = $2 and active = true
     for share`,
    [workorderId, mechanicUserId],
  );
  if (!assignment.rows[0]) {
    throw new WorkLogConflictError(
      "WORK_LOG_ASSIGNMENT_CHANGED",
      "Your workorder assignment changed. Reload before saving.",
    );
  }
}

export async function readWorkorderWorkLog(workorderId, { client = null } = {}) {
  const runner = client || getPool();
  const queries = [
    () => runner.query(
      `select id, company_id, status, activity_status, activity_version
       from operational_workorders where id = $1 limit 1`,
      [workorderId],
    ),
    () => runner.query(
      `select entry.*, mechanic.display_name as mechanic_name,
              creator.display_name as created_by_name
       from workorder_labor_entries entry
       join user_profiles mechanic on mechanic.id = entry.mechanic_user_id
       join user_profiles creator on creator.id = entry.created_by_user_id
       where entry.workorder_id = $1
       order by entry.work_date, entry.created_at, entry.id`,
      [workorderId],
    ),
    () => runner.query(
      `select revision.*, actor.display_name as changed_by_name
       from workorder_labor_entry_revisions revision
       join user_profiles actor on actor.id = revision.changed_by_user_id
       where revision.workorder_id = $1
       order by revision.entry_id, revision.version`,
      [workorderId],
    ),
  ];
  const [workorderResult, entriesResult, revisionsResult] = client
    ? [await queries[0](), await queries[1](), await queries[2]()]
    : await Promise.all(queries.map((run) => run()));
  const workorder = workorderResult.rows[0];
  if (!workorder) return null;
  const revisionsByEntry = new Map();
  for (const row of revisionsResult.rows) {
    const revisions = revisionsByEntry.get(row.entry_id) || [];
    revisions.push({
      version: Number(row.version),
      minutes: row.minutes,
      hours: hours(row.minutes),
      date: dateValue(row.work_date),
      note: row.note || "",
      correctionReason: row.correction_reason || "",
      changedAt: row.changed_at,
      changedByUserId: row.changed_by_user_id,
      changedByName: row.changed_by_name || "",
    });
    revisionsByEntry.set(row.entry_id, revisions);
  }
  const entries = entriesResult.rows.map((row) => ({
    id: row.id,
    mechanicId: row.mechanic_user_id,
    mechanicUserId: row.mechanic_user_id,
    mechanicName: row.mechanic_name || "",
    minutes: row.minutes,
    hours: hours(row.minutes),
    date: dateValue(row.work_date),
    note: row.note || "",
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name || "",
    revisions: revisionsByEntry.get(row.id) || [],
  }));
  return {
    workorder: {
      id: workorder.id,
      companyId: workorder.company_id,
      status: workorder.status,
      activityStatus: workorder.activity_status,
      activityVersion: Number(workorder.activity_version),
    },
    entries,
    totalMinutes: entries.reduce((sum, entry) => sum + entry.minutes, 0),
  };
}

export async function changeWorkorderActivityStatus({
  workorderId, companyId, status, expectedVersion, actorUserId, mechanicUserId = null,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const currentResult = await client.query(
      `select id, company_id, status, activity_status, activity_version
       from operational_workorders where id = $1 and company_id = $2 for update`,
      [workorderId, companyId],
    );
    const current = currentResult.rows[0];
    if (!current) {
      await client.query("rollback");
      return null;
    }
    await assertAssignedMechanic(client, workorderId, mechanicUserId);
    if (!["accepted", "in_progress"].includes(current.status)) {
      throw new WorkLogConflictError("WORK_LOG_STATUS_LOCKED", "Operational status cannot be changed on this workorder.");
    }
    if (Number(current.activity_version) !== expectedVersion) {
      throw new WorkLogConflictError("WORK_LOG_VERSION_CONFLICT", "This work log changed elsewhere. Reload before saving.");
    }
    if (current.activity_status === status) {
      await client.query("commit");
      return false;
    }
    if (status === "active") {
      await assertCurrentExternalEstimateAccepted(client, { companyId, workorderId });
    }
    const nextVersion = expectedVersion + 1;
    const startsLifecycle = status === "active" && current.status === "accepted";
    await client.query(
      `update operational_workorders
       set activity_status = $3,
           activity_version = $4,
           status = case when $6::boolean then 'in_progress' else status end,
           started_at = case when $6::boolean then coalesce(started_at, now()) else started_at end,
           updated_at = now()
       where id = $1 and company_id = $2 and activity_version = $5`,
      [workorderId, companyId, status, nextVersion, expectedVersion, startsLifecycle],
    );
    await client.query(
      `insert into workorder_activity_status_events (
         company_id, workorder_id, from_status, to_status, version, changed_by_user_id
       ) values ($1, $2, $3, $4, $5, $6)`,
      [companyId, workorderId, current.activity_status, status, nextVersion, actorUserId],
    );
    if (startsLifecycle) {
      await client.query(
        `insert into workorder_status_events (
           workorder_id, from_status, to_status, changed_by_user_id, note
         ) values ($1, 'accepted', 'in_progress', $2, 'Work started from operational status.')`,
        [workorderId, actorUserId],
      );
    }
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function createWorkorderLaborEntry({
  workorderId, companyId, entryId, mechanicUserId, minutes, date, note, actorUserId,
}) {
  const client = await getPool().connect();
  const hash = requestHash({ workorderId, mechanicUserId, minutes, date, note });
  try {
    await client.query("begin");
    const workorderResult = await client.query(
      `select id, status from operational_workorders
       where id = $1 and company_id = $2 for update`,
      [workorderId, companyId],
    );
    if (!workorderResult.rows[0]) {
      await client.query("rollback");
      return null;
    }
    if (!["accepted", "in_progress", "mechanic_done"].includes(workorderResult.rows[0].status)) {
      throw new WorkLogConflictError("WORK_LOG_LABOR_LOCKED", "Labor cannot be added to this workorder.");
    }
    await assertAssignedMechanic(client, workorderId, mechanicUserId);
    const existing = await client.query(
      `select request_hash from workorder_labor_entries where id = $1 for update`,
      [entryId],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== hash) {
        throw new WorkLogConflictError(
          "WORK_LOG_IDEMPOTENCY_MISMATCH",
          "This labor entry id was already used with different values.",
        );
      }
      await client.query("commit");
      return false;
    }
    await client.query(
      `insert into workorder_labor_entries (
         id, company_id, workorder_id, mechanic_user_id, minutes, work_date, note,
         created_by_user_id, request_hash
       ) values ($1, $2, $3, $4, $5, $6::date, $7, $8, $9)`,
      [entryId, companyId, workorderId, mechanicUserId, minutes, date, note, actorUserId, hash],
    );
    await client.query(
      `insert into workorder_labor_entry_revisions (
         company_id, workorder_id, entry_id, version, minutes, work_date, note,
         correction_reason, changed_by_user_id
       ) values ($1, $2, $3, 1, $4, $5::date, $6, '', $7)`,
      [companyId, workorderId, entryId, minutes, date, note, actorUserId],
    );
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if (error?.code === "23505") {
      const existing = await client.query(
        `select request_hash from workorder_labor_entries where id = $1 limit 1`,
        [entryId],
      );
      if (existing.rows[0]?.request_hash === hash) return false;
      throw new WorkLogConflictError("WORK_LOG_IDEMPOTENCY_MISMATCH", "This labor entry id was already used.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function correctWorkorderLaborEntry({
  workorderId, companyId, entryId, minutes, date, note, expectedVersion,
  correctionReason, actorUserId, mechanicUserId = null,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const currentResult = await client.query(
      `select entry.*, workorder.status as workorder_status
       from workorder_labor_entries entry
       join operational_workorders workorder
         on workorder.company_id = entry.company_id and workorder.id = entry.workorder_id
       where entry.id = $1 and entry.workorder_id = $2 and entry.company_id = $3
       for update of entry, workorder`,
      [entryId, workorderId, companyId],
    );
    const current = currentResult.rows[0];
    if (!current || (mechanicUserId && current.mechanic_user_id !== mechanicUserId)) {
      await client.query("rollback");
      return null;
    }
    if (!["accepted", "in_progress", "mechanic_done"].includes(current.workorder_status)) {
      throw new WorkLogConflictError("WORK_LOG_LABOR_LOCKED", "Labor cannot be corrected on this workorder.");
    }
    await assertAssignedMechanic(client, workorderId, mechanicUserId);
    if (Number(current.version) !== expectedVersion) {
      throw new WorkLogConflictError("WORK_LOG_LABOR_VERSION_CONFLICT", "This labor entry changed elsewhere. Reload before saving.");
    }
    const nextVersion = expectedVersion + 1;
    const updated = await client.query(
      `update workorder_labor_entries
       set minutes = $4, work_date = $5::date, note = $6, version = $7, updated_at = now()
       where id = $1 and workorder_id = $2 and company_id = $3 and version = $8
       returning id`,
      [entryId, workorderId, companyId, minutes, date, note, nextVersion, expectedVersion],
    );
    if (!updated.rows[0]) {
      throw new WorkLogConflictError("WORK_LOG_LABOR_VERSION_CONFLICT", "This labor entry changed elsewhere. Reload before saving.");
    }
    await client.query(
      `insert into workorder_labor_entry_revisions (
         company_id, workorder_id, entry_id, version, minutes, work_date, note,
         correction_reason, changed_by_user_id
       ) values ($1, $2, $3, $4, $5, $6::date, $7, $8, $9)`,
      [companyId, workorderId, entryId, nextVersion, minutes, date, note, correctionReason, actorUserId],
    );
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
