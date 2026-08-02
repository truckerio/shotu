import { getPool, query } from "../../db/pool.js";
import { requireCompanyId } from "../../db/company.js";
import { requestPayloadHash } from "../core/integration-crypto.js";
import {
  appendIntegrationAudit,
  appendOutboxEvent,
  upsertIntegrationMapping,
} from "../core/integration-platform.repo.js";
import {
  integrationConflict,
  integrationInvalidRequest,
  integrationNotFound,
} from "../core/integration-errors.js";

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({
    updatedAt: new Date(row.updated_at).toISOString(),
    id: row.id,
  }), "utf8").toString("base64url");
}

export function decodeOdooCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!value.updatedAt || !value.id || Number.isNaN(new Date(value.updatedAt).getTime())) throw new Error();
    return value;
  } catch {
    throw integrationInvalidRequest("INVALID_CURSOR", "The pagination cursor is invalid or expired.");
  }
}

function odooStatusCondition(status) {
  if (status === "pending") {
    return "wo.status = 'closed' and coalesce(oe.status, 'not_entered') = 'not_entered'";
  }
  if (status === "missing_info") {
    return "wo.status in ('closed', 'odoo_entered') and oe.status = 'missing_info'";
  }
  return "wo.status = 'odoo_entered' and oe.status = 'entered'";
}

export function odooPartsFromForm(form = {}) {
  if (!Array.isArray(form.parts)) return [];
  return form.parts
    .filter((part) => part && (part.partNo || part.qty || part.repairOrder))
    .map((part) => ({
      partNo: String(part.partNo || ""),
      qty: String(part.qty || ""),
      uomCode: String(part.uomCode || ""),
      repairOrder: String(part.repairOrder || ""),
    }));
}

export async function listOdooWorkorders({ companyId, status, limit, cursor }) {
  const tenantId = requireCompanyId(companyId);
  const decoded = decodeOdooCursor(cursor);
  const params = [tenantId];
  let cursorSql = "";
  if (decoded) {
    params.push(decoded.updatedAt, decoded.id);
    cursorSql = `and (wo.updated_at, wo.id) < ($2::timestamptz, $3::uuid)`;
  }
  params.push(limit + 1);
  const result = await query(
    `select
       wo.id,
       wo.serial,
       wo.status as lifecycle,
       coalesce(oe.status, 'not_entered') as odoo_status,
       wo.updated_at
     from operational_workorders wo
     left join odoo_entry_status oe on oe.workorder_id = wo.id
     where wo.company_id = $1
       and ${odooStatusCondition(status)}
       ${cursorSql}
     order by wo.updated_at desc, wo.id desc
     limit $${params.length}`,
    params,
  );
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  return {
    items: rows.map((row) => ({
      id: row.id,
      serial: row.serial,
      lifecycle: row.lifecycle,
      odooStatus: row.odoo_status,
      updatedAt: row.updated_at,
    })),
    nextCursor: hasMore && rows.length ? encodeCursor(rows.at(-1)) : null,
  };
}

export async function getOdooWorkorder({ companyId, workorderId }) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `select
       wo.id,
       wo.company_id,
       wo.serial,
       wo.status as lifecycle,
       wo.concern,
       wo.diagnosis,
       wo.work_performed,
       wo.office_notes,
       wo.form_data,
       wo.closed_at,
       wo.created_at,
       wo.updated_at,
       coalesce(oe.status, 'not_entered') as odoo_status,
       oe.odoo_service_order_no,
       oe.external_id,
       case when location.id is null then null else jsonb_build_object(
         'id', location.id,
         'name', location.name,
         'type', location.type,
         'address', location.address
       ) end as location,
       case when asset.id is null then null else jsonb_build_object(
         'id', asset.id,
         'unitNo', asset.unit_no,
         'name', asset.name,
         'unitType', asset.unit_type,
         'vin', asset.vin,
         'licensePlate', asset.license_plate,
         'make', asset.make,
         'model', asset.model,
         'year', asset.year,
         'lastOdometerMiles', asset.last_odometer_miles,
         'ownerName', asset.owner_name
       ) end as asset,
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'id', mechanic.id,
           'name', mechanic.display_name,
           'assignmentRole', assignment.assignment_role,
           'assignedAt', assignment.assigned_at
         ) order by assignment.assigned_at, mechanic.id)
         from workorder_mechanic_assignments assignment
         join user_profiles mechanic on mechanic.id = assignment.mechanic_user_id
         where assignment.workorder_id = wo.id and assignment.active = true
       ), '[]'::jsonb) as mechanics
     from operational_workorders wo
     left join odoo_entry_status oe on oe.workorder_id = wo.id
     left join locations location on location.id = wo.location_id
     left join assets asset on asset.id = wo.asset_id
     where wo.company_id = $1
       and wo.id = $2
       and wo.status in ('closed', 'odoo_entered')
     limit 1`,
    [tenantId, workorderId],
  );
  const row = result.rows[0];
  if (!row) throw integrationNotFound("Workorder");
  const form = row.form_data || {};
  return {
    id: row.id,
    companyId: row.company_id,
    serial: row.serial,
    lifecycle: row.lifecycle,
    odooStatus: row.odoo_status,
    serviceOrderNo: row.odoo_service_order_no || "",
    externalId: row.external_id || "",
    concern: row.concern,
    diagnosis: row.diagnosis,
    workPerformed: row.work_performed,
    officeNotes: row.office_notes,
    customer: {
      displayName: form.customerCompanyName || "",
    },
    workDates: {
      start: form.workStartDate || form.workDate || null,
      end: form.workEndDate || form.workDate || null,
    },
    odometer: form.mileage || row.asset?.lastOdometerMiles || null,
    location: row.location,
    asset: row.asset,
    mechanics: row.mechanics || [],
    parts: odooPartsFromForm(form),
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function existingIdempotencyRecord(client, integrationClientId, idempotencyKey) {
  const result = await client.query(
    `select method, path, request_hash, response_status, response_body, completed_at
     from integration_idempotency_records
     where integration_client_id = $1 and idempotency_key = $2
     limit 1`,
    [integrationClientId, idempotencyKey],
  );
  return result.rows[0] || null;
}

export async function recordOdooResultAtomic({
  companyId,
  integrationClientId,
  workorderId,
  input,
  idempotencyKey,
  requestId,
  path,
}) {
  const tenantId = requireCompanyId(companyId);
  const requestHash = requestPayloadHash({ method: "PUT", path, body: input });
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const inserted = await client.query(
      `insert into integration_idempotency_records (
         company_id, integration_client_id, method, path, idempotency_key, request_hash
       ) values ($1, $2, 'PUT', $3, $4, $5)
       on conflict (integration_client_id, idempotency_key) do nothing
       returning id`,
      [tenantId, integrationClientId, path, idempotencyKey, requestHash],
    );
    if (!inserted.rows[0]) {
      const existing = await existingIdempotencyRecord(client, integrationClientId, idempotencyKey);
      if (
        existing?.method !== "PUT"
        || existing?.path !== path
        || existing?.request_hash !== requestHash
      ) {
        throw integrationConflict(
          "IDEMPOTENCY_KEY_REUSED",
          "The idempotency key was already used with a different request.",
        );
      }
      if (existing?.completed_at) {
        await client.query("commit");
        return {
          statusCode: Number(existing.response_status) || 200,
          body: existing.response_body,
          replayed: true,
        };
      }
      throw integrationConflict("IDEMPOTENCY_REQUEST_IN_PROGRESS", "A matching request is already being processed.");
    }

    const locked = await client.query(
      `select id, status, serial
       from operational_workorders
       where company_id = $1 and id = $2
       for update`,
      [tenantId, workorderId],
    );
    const workorder = locked.rows[0];
    if (!workorder) throw integrationNotFound("Workorder");
    if (!["closed", "odoo_entered"].includes(workorder.status)) {
      throw integrationConflict(
        "WORKORDER_NOT_ELIGIBLE",
        "Office approval is required before Odoo processing.",
      );
    }
    const attentionResult = await client.query(
      `select active
       from workorder_attention_state
       where workorder_id = $1 and reason = 'missing_info'
       for update`,
      [workorderId],
    );
    const previousAttention = attentionResult.rows[0] || null;

    if (input.status === "entered") {
      await client.query(
        `insert into odoo_entry_status (
           workorder_id, status, odoo_service_order_no, external_id, entered_by_user_id,
           entered_at, note, updated_at
         ) values ($1, 'entered', $2, $3, null, now(), $4, now())
         on conflict (workorder_id) do update
         set status = 'entered',
             odoo_service_order_no = excluded.odoo_service_order_no,
             external_id = excluded.external_id,
             entered_by_user_id = null,
             entered_at = now(),
             note = excluded.note,
             updated_at = now()`,
        [workorderId, input.serviceOrderNo, input.externalId, input.note || ""],
      );
      await client.query(
        `update operational_workorders
         set status = 'odoo_entered', updated_at = now()
         where id = $1`,
        [workorderId],
      );
      await client.query(
        `insert into workorder_attention_state (
           workorder_id, reason, active, details, resolved_at, updated_at
         ) values ($1, 'missing_info', false, $2::jsonb, now(), now())
         on conflict (workorder_id, reason) do update
         set active = false, details = excluded.details, resolved_at = now(), updated_at = now()`,
        [workorderId, JSON.stringify({ source: "odoo_integration" })],
      );
      if (previousAttention?.active) {
        await client.query(
          `insert into workorder_attention_events (workorder_id, reason, action, details)
           values ($1, 'missing_info', 'resolved', $2::jsonb)`,
          [workorderId, JSON.stringify({ source: "odoo_integration" })],
        );
      }
      await upsertIntegrationMapping({
        client,
        companyId: tenantId,
        provider: "odoo",
        entityType: "workorder",
        internalId: workorderId,
        externalId: input.externalId,
        metadata: { serviceOrderNo: input.serviceOrderNo },
      });
    } else {
      await client.query(
        `insert into odoo_entry_status (workorder_id, status, note, updated_at)
         values ($1, 'missing_info', $2, now())
         on conflict (workorder_id) do update
         set status = 'missing_info',
             note = excluded.note,
             updated_at = now()`,
        [workorderId, input.note],
      );
      await client.query(
        `insert into workorder_attention_state (
           workorder_id, reason, active, details, opened_at, resolved_at, updated_at
         ) values ($1, 'missing_info', true, $2::jsonb, now(), null, now())
         on conflict (workorder_id, reason) do update
         set active = true,
             details = excluded.details,
             opened_at = case when workorder_attention_state.active then workorder_attention_state.opened_at else now() end,
             resolved_at = null,
             updated_at = now()`,
        [workorderId, JSON.stringify({ source: "odoo_integration", note: input.note })],
      );
      await client.query(
        `insert into workorder_attention_events (workorder_id, reason, action, details)
         values ($1, 'missing_info', $2, $3::jsonb)`,
        [
          workorderId,
          previousAttention ? previousAttention.active ? "updated" : "reopened" : "opened",
          JSON.stringify({ source: "odoo_integration", note: input.note }),
        ],
      );
    }

    const body = {
      workorderId,
      status: input.status,
      serviceOrderNo: input.status === "entered" ? input.serviceOrderNo : "",
      externalId: input.status === "entered" ? input.externalId : "",
      note: input.note || "",
      updatedAt: new Date().toISOString(),
    };
    await appendIntegrationAudit({
      client,
      companyId: tenantId,
      provider: "odoo",
      action: input.status === "entered" ? "workorder.entered" : "workorder.missing_info",
      actorType: "integration_client",
      actorId: integrationClientId,
      integrationClientId,
      targetType: "workorder",
      targetId: workorderId,
      requestId,
      details: {
        serviceOrderNo: body.serviceOrderNo,
        externalId: body.externalId,
      },
    });
    await appendOutboxEvent({
      client,
      companyId: tenantId,
      aggregateType: "workorder",
      aggregateId: workorderId,
      eventType: input.status === "entered" ? "odoo.workorder_entered" : "odoo.missing_info",
      payload: body,
      requestId,
    });
    await client.query(
      `update integration_idempotency_records
       set response_status = 200, response_body = $3::jsonb, completed_at = now()
       where integration_client_id = $1 and idempotency_key = $2`,
      [integrationClientId, idempotencyKey, JSON.stringify(body)],
    );
    await client.query("commit");
    return { statusCode: 200, body, replayed: false };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
