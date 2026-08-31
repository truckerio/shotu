import { getPool } from "../pool.js";

const TERMINAL_STATUSES = new Set(["mechanic_done", "closed", "odoo_entered", "cancelled"]);

export class WorkorderProgressConflictError extends Error {
  constructor(message = "This workorder changed elsewhere. Reload before saving.") {
    super(message);
    this.name = "WorkorderProgressConflictError";
    this.statusCode = 409;
    this.code = "WORKORDER_PROGRESS_VERSION_CONFLICT";
  }
}

function textValue(value) {
  return String(value ?? "").trim();
}

function changedDetails(before, next) {
  return ["diagnosis", "workPerformed", "laborHours"]
    .filter((field) => before[field] !== next[field])
    .map((field) => ({
      field,
      oldValue: before[field],
      newValue: next[field],
    }));
}

function publicProgress(row) {
  return {
    diagnosis: row.diagnosis || "",
    workPerformed: row.work_performed || "",
    laborHours: String(row.form_data?.laborHours || ""),
    version: row.progress_version,
    savedAt: row.updated_at,
  };
}

export async function saveMechanicWorkorderProgress({
  workorderId,
  mechanicUserId,
  diagnosis,
  workPerformed,
  laborHours,
  expectedVersion,
  recordActivity = false,
}) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const currentResult = await client.query(
      `
        select
          wo.id,
          wo.status,
          wo.diagnosis,
          wo.work_performed,
          wo.form_data,
          wo.progress_version,
          wo.progress_activity_version,
          wo.progress_pending_fields,
          wo.updated_at
        from operational_workorders wo
        where wo.id = $1
          and exists (
            select 1
            from workorder_mechanic_assignments assignment
            where assignment.workorder_id = wo.id
              and assignment.mechanic_user_id = $2
              and assignment.active = true
          )
        for update of wo
      `,
      [workorderId, mechanicUserId],
    );
    const current = currentResult.rows[0];
    if (!current) {
      await client.query("rollback");
      return null;
    }
    if (TERMINAL_STATUSES.has(current.status)) {
      const error = new Error("Progress cannot be changed on a completed workorder.");
      error.statusCode = 409;
      error.code = "WORKORDER_PROGRESS_LOCKED";
      throw error;
    }
    if (current.progress_version !== expectedVersion) {
      throw new WorkorderProgressConflictError();
    }

    const before = {
      diagnosis: current.diagnosis || "",
      workPerformed: current.work_performed || "",
      laborHours: String(current.form_data?.laborHours || ""),
    };
    const next = {
      diagnosis: textValue(diagnosis),
      workPerformed: textValue(workPerformed),
      laborHours: laborHours === undefined ? before.laborHours : textValue(laborHours),
    };
    const changes = changedDetails(before, next);
    const existingPendingFields = Array.isArray(current.progress_pending_fields)
      ? current.progress_pending_fields.map(String)
      : [];
    const pendingFields = [...new Set([
      ...existingPendingFields,
      ...changes.map(({ field }) => field),
    ])];
    const shouldRecordActivity = recordActivity && pendingFields.length > 0;
    if (!changes.length && !shouldRecordActivity) {
      await client.query("commit");
      return publicProgress(current);
    }

    const updatedResult = await client.query(
      `
        update operational_workorders
        set diagnosis = $3,
            work_performed = $4,
            form_data = $9::jsonb,
            progress_version = progress_version + $6,
            progress_activity_version = case when $7::boolean then progress_version + $6 else progress_activity_version end,
            progress_pending_fields = case when $7::boolean then '[]'::jsonb else $8::jsonb end,
            status = case when status = 'accepted' then 'in_progress' else status end,
            started_at = coalesce(started_at, now()),
            updated_at = now()
        where id = $1
          and progress_version = $5
          and exists (
            select 1
            from workorder_mechanic_assignments assignment
            where assignment.workorder_id = operational_workorders.id
              and assignment.mechanic_user_id = $2
              and assignment.active = true
          )
        returning diagnosis, work_performed, form_data, progress_version, updated_at
      `,
      [
        workorderId,
        mechanicUserId,
        next.diagnosis,
        next.workPerformed,
        expectedVersion,
        changes.length ? 1 : 0,
        shouldRecordActivity,
        JSON.stringify(pendingFields),
        JSON.stringify({ ...(current.form_data || {}), laborHours: next.laborHours }),
      ],
    );
    const updated = updatedResult.rows[0];
    if (!updated) throw new WorkorderProgressConflictError();

    if (shouldRecordActivity) {
      await client.query(
        `
          insert into workorder_field_events (
            workorder_id, field_key, field_label, old_value, new_value, changed_by_user_id
          )
          values ($1, 'work_details_updated', 'Work details updated', $2, $3, $4)
        `,
        [
          workorderId,
          JSON.stringify({ fieldsChanged: pendingFields }),
          JSON.stringify({
            fieldsChanged: pendingFields,
            diagnosis: next.diagnosis,
            workPerformed: next.workPerformed,
            laborHours: next.laborHours,
          }),
          mechanicUserId,
        ],
      );
    }

    await client.query("commit");
    return publicProgress(updated);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
