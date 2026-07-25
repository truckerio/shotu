import { getPool, query } from "../pool.js";
import { DEFAULT_COMPANY_ID } from "../company.js";
import { WORKORDER_STATUS } from "../../modules/workorders/workorder.constants.js";

function publicAssetSelect(alias = "a", workorderAlias = "wo") {
  return `
    jsonb_build_object(
      'id', ${alias}.id,
      'unitNo', coalesce(${alias}.unit_no, nullif(${workorderAlias}.form_data->>'unitNo', '')),
      'name', ${alias}.name,
      'unitType', coalesce(${alias}.unit_type, nullif(${workorderAlias}.form_data->>'unitType', '')),
      'vin', coalesce(${alias}.vin, nullif(${workorderAlias}.form_data->>'vinNo', '')),
      'licensePlate', coalesce(${alias}.license_plate, nullif(${workorderAlias}.form_data->>'licenseNo', '')),
      'make', ${alias}.make,
      'model', coalesce(${alias}.model, nullif(${workorderAlias}.form_data->>'model', '')),
      'year', ${alias}.year,
      'engine', coalesce(
        nullif(${workorderAlias}.form_data->>'engine', ''),
        nullif(${alias}.raw_provider_data->>'engineName', ''),
        nullif(${alias}.raw_provider_data->>'engineModel', ''),
        case left(regexp_replace(coalesce(${alias}.raw_provider_data->>'esn', ''), '[^A-Za-z0-9]', '', 'g'), 3)
          when '471' then 'Detroit DD13'
          when '472' then 'Detroit DD15'
          when '473' then 'Detroit DD16'
          else null
        end
      ),
      'engineSerial', coalesce(
        nullif(${workorderAlias}.form_data->>'engineSerial', ''),
        nullif(${alias}.raw_provider_data->>'engineSerial', ''),
        nullif(${alias}.raw_provider_data->>'esn', '')
      ),
      'lastOdometerMiles', ${alias}.last_odometer_miles,
      'lastLocation', ${alias}.last_location,
      'lastSeenAt', ${alias}.last_seen_at
    )
  `;
}

function workorderSelect() {
  return `
    select
      wo.id,
      wo.company_uuid as company_id,
      wo.serial,
      wo.asset_id,
      wo.location_id,
      wo.created_by_user_id,
      wo.current_mechanic_id,
      wo.status,
      wo.concern,
      wo.diagnosis,
      wo.work_performed,
      wo.office_notes,
      wo.form_data,
      wo.accepted_at,
      wo.started_at,
      wo.mechanic_done_at,
      wo.closed_at,
      wo.created_at,
      wo.updated_at,
      ${publicAssetSelect("a")} as asset,
      jsonb_build_object('id', l.id, 'name', l.name, 'type', l.type, 'address', l.address) as location,
      jsonb_build_object('id', m.id, 'name', m.name, 'email', m.email, 'role', m.role) as mechanic,
      coalesce(team.mechanics, '[]'::jsonb) as mechanics,
      coalesce(team.mechanic_ids, '{}'::uuid[]) as mechanic_ids
    from operational_workorders wo
    left join assets a on a.id = wo.asset_id
    left join locations l on l.id = wo.location_id
    left join app_users m on m.id = wo.current_mechanic_id
    left join lateral (
      select
        jsonb_agg(
          jsonb_build_object(
            'id', member.id,
            'name', member.name,
            'email', member.email,
            'role', member.role,
            'assignmentRole', assignment.assignment_role,
            'assignedAt', assignment.assigned_at
          )
          order by case assignment.assignment_role when 'primary' then 0 else 1 end, member.name
        ) as mechanics,
        array_agg(assignment.mechanic_user_id) as mechanic_ids
      from workorder_mechanic_assignments assignment
      join app_users member on member.id = assignment.mechanic_user_id
      where assignment.workorder_id = wo.id
        and assignment.active = true
    ) team on true
  `;
}

function emptyObjectToNull(value) {
  if (!value || Object.values(value).every((entry) => entry === null)) return null;
  return value;
}

export function publicWorkorderRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    serial: row.serial,
    assetId: row.asset_id,
    locationId: row.location_id,
    createdByUserId: row.created_by_user_id,
    currentMechanicId: row.current_mechanic_id,
    status: row.status,
    concern: row.concern,
    diagnosis: row.diagnosis,
    workPerformed: row.work_performed,
    officeNotes: row.office_notes,
    formData: row.form_data || {},
    acceptedAt: row.accepted_at,
    startedAt: row.started_at,
    mechanicDoneAt: row.mechanic_done_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    asset: emptyObjectToNull(row.asset),
    location: emptyObjectToNull(row.location),
    mechanic: emptyObjectToNull(row.mechanic),
    mechanics: Array.isArray(row.mechanics) ? row.mechanics : [],
    mechanicIds: Array.isArray(row.mechanic_ids) ? row.mechanic_ids : [],
  };
}

async function nextSerial(client, companyId) {
  const keyResult = await client.query(
    `
      select legacy_key
      from company_legacy_keys
      where company_id = $1
      order by is_primary desc, created_at, legacy_key
      limit 1
    `,
    [companyId],
  );
  const legacyKey = keyResult.rows[0]?.legacy_key;
  if (!legacyKey) throw new Error("Company has no serial compatibility key.");

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const counter = await client.query(
      `
        insert into workorder_serial_counters (company_id, company_uuid)
        values ($1, $2)
        on conflict (company_id) do update
          set company_uuid = excluded.company_uuid,
              updated_at = now()
        returning company_id, prefix, next_number, digits
      `,
      [legacyKey, companyId]
    );
    const row = counter.rows[0];
    const serial = `${row.prefix}${String(row.next_number).padStart(row.digits, "0")}`;
    await client.query(
      `
        update workorder_serial_counters
        set next_number = next_number + 1,
            updated_at = now()
        where company_id = $1
      `,
      [legacyKey]
    );
    const existing = await client.query(
      "select 1 from operational_workorders where company_uuid = $1 and serial = $2 limit 1",
      [companyId, serial],
    );
    if (!existing.rows[0]) return serial;
  }
  throw new Error("Could not allocate unique workorder serial.");
}

async function addStatusEvent(client, { workorderId, fromStatus, toStatus, changedByUserId, note = "" }) {
  await client.query(
    `
      insert into workorder_status_events (workorder_id, from_status, to_status, changed_by_user_id, note)
      values ($1, $2, $3, $4, $5)
    `,
    [workorderId, fromStatus || null, toStatus, changedByUserId || null, note]
  );
}

async function addAssignmentEvent(client, { workorderId, fromMechanicId, toMechanicId, action, reason = "", changedByUserId }) {
  await client.query(
    `
      insert into workorder_assignment_events (
        workorder_id, from_mechanic_id, to_mechanic_id, action, reason, changed_by_user_id
      )
      values ($1, $2, $3, $4, $5, $6)
    `,
    [workorderId, fromMechanicId || null, toMechanicId || null, action, reason, changedByUserId || null]
  );
}

const FIELD_EVENT_LABELS = {
  assetId: "Asset",
  locationId: "Location",
  concern: "Concern",
  diagnosis: "Diagnosis",
  workPerformed: "Work performed",
  officeNotes: "Office notes",
  "formData.companyName": "Company",
  "formData.unitNo": "Unit no.",
  "formData.unitType": "Unit type",
  "formData.licenseNo": "License",
  "formData.mileage": "Mileage",
  "formData.model": "Model",
  "formData.vinNo": "VIN",
  "formData.mechanicConcern": "Mechanic concern",
  "formData.mechanicName": "Mechanic name",
  "formData.workStartDate": "Start date",
  "formData.workEndDate": "End date",
  "formData.parts": "Used parts",
};

function textValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

function changedFields(before, input) {
  const changes = [];
  const compare = (key, oldValue, newValue) => {
    const oldText = textValue(oldValue);
    const newText = textValue(newValue);
    if (oldText === newText) return;
    changes.push({
      fieldKey: key,
      fieldLabel: FIELD_EVENT_LABELS[key] || key,
      oldValue: oldText,
      newValue: newText,
    });
  };

  if (Object.prototype.hasOwnProperty.call(input, "assetId")) compare("assetId", before.asset_id, input.assetId);
  if (Object.prototype.hasOwnProperty.call(input, "locationId")) compare("locationId", before.location_id, input.locationId);
  if (Object.prototype.hasOwnProperty.call(input, "concern")) compare("concern", before.concern, input.concern);
  if (Object.prototype.hasOwnProperty.call(input, "diagnosis")) compare("diagnosis", before.diagnosis, input.diagnosis);
  if (Object.prototype.hasOwnProperty.call(input, "workPerformed")) compare("workPerformed", before.work_performed, input.workPerformed);
  if (Object.prototype.hasOwnProperty.call(input, "officeNotes")) compare("officeNotes", before.office_notes, input.officeNotes);

  if (Object.prototype.hasOwnProperty.call(input, "formData")) {
    const oldForm = before.form_data || {};
    const newForm = input.formData || {};
    for (const key of Object.keys(FIELD_EVENT_LABELS).filter((entry) => entry.startsWith("formData."))) {
      const formKey = key.slice("formData.".length);
      compare(key, oldForm[formKey], newForm[formKey]);
    }
  }

  return changes;
}

async function addFieldEvents(client, { workorderId, changes, changedByUserId }) {
  for (const change of changes) {
    await client.query(
      `
        insert into workorder_field_events (
          workorder_id, field_key, field_label, old_value, new_value, changed_by_user_id
        )
        values ($1, $2, $3, $4, $5, $6)
      `,
      [workorderId, change.fieldKey, change.fieldLabel, change.oldValue, change.newValue, changedByUserId || null]
    );
  }
}

export async function createOperationalWorkorder(input) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const companyId = input.companyId || DEFAULT_COMPANY_ID;
    const serial = await nextSerial(client, companyId);
    const result = await client.query(
      `
        insert into operational_workorders (
          company_uuid, serial, asset_id, location_id, created_by_user_id, concern, office_notes, form_data
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        returning id, status
      `,
      [
        companyId,
        serial,
        input.assetId || null,
        input.locationId || null,
        input.createdByUserId || null,
        input.concern,
        input.officeNotes || "",
        JSON.stringify(input.formData || {}),
      ]
    );
    await addStatusEvent(client, {
      workorderId: result.rows[0].id,
      toStatus: result.rows[0].status,
      changedByUserId: input.createdByUserId,
      note: "Workorder created.",
    });
    await client.query("commit");
    return getOperationalWorkorderById(result.rows[0].id);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateOperationalWorkorder(workorderId, input) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const beforeResult = await client.query("select * from operational_workorders where id = $1 for update", [workorderId]);
    const before = beforeResult.rows[0];
    if (!before) throw new Error("Workorder not found.");
    const changes = changedFields(before, input);
    await client.query(
      `
        update operational_workorders
        set asset_id = case when $2::boolean then $3::uuid else asset_id end,
            location_id = case when $4::boolean then $5::uuid else location_id end,
            concern = coalesce($6, concern),
            office_notes = coalesce($7, office_notes),
            form_data = coalesce($8::jsonb, form_data),
            updated_at = now()
        where id = $1
      `,
      [
        workorderId,
        Object.prototype.hasOwnProperty.call(input, "assetId"),
        input.assetId || null,
        Object.prototype.hasOwnProperty.call(input, "locationId"),
        input.locationId || null,
        input.concern ?? null,
        input.officeNotes ?? null,
        input.formData === undefined ? null : JSON.stringify(input.formData || {}),
      ]
    );
    await addFieldEvents(client, { workorderId, changes, changedByUserId: input.changedByUserId });
    await client.query("commit");
    return getOperationalWorkorderById(workorderId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function listOperationalWorkorders({
  statuses = [],
  mechanicUserId = null,
  unassigned = false,
  companyIds = [],
  locationIds = [],
  limit = 100,
} = {}) {
  const result = await query(
    `
      ${workorderSelect()}
      where ($1::text[] is null or wo.status = any($1::text[]))
        and (
          $2::uuid is null
          or exists (
            select 1
            from workorder_mechanic_assignments assignment
            where assignment.workorder_id = wo.id
              and assignment.mechanic_user_id = $2
              and assignment.active = true
          )
        )
        and (
          $3::boolean = false
          or not exists (
            select 1
            from workorder_mechanic_assignments assignment
            where assignment.workorder_id = wo.id
              and assignment.active = true
          )
        )
        and ($4::uuid[] is null or wo.company_uuid = any($4::uuid[]))
        and ($5::uuid[] is null or wo.location_id = any($5::uuid[]))
      order by wo.updated_at desc
      limit $6
    `,
    [
      statuses.length ? statuses : null,
      mechanicUserId,
      unassigned,
      companyIds.length ? companyIds : null,
      locationIds.length ? locationIds : null,
      limit,
    ]
  );
  return result.rows.map(publicWorkorderRow);
}

const OPERATIONS_SORT = Object.freeze({
  lastActivityAt: "last_activity_at",
  createdAt: "created_at",
  age: "age_seconds",
  timeInStatus: "time_in_status_seconds",
});

const OPERATIONS_CATEGORY = Object.freeze({
  all: "true",
  needs_attention: "cardinality(attention_reasons) > 0",
  unassigned: "lifecycle = 'open' and cardinality(mechanic_ids) = 0",
  active: "lifecycle in ('accepted', 'in_progress')",
  parts: "'parts' = any(attention_reasons)",
  ready_review: "lifecycle = 'mechanic_done'",
  odoo_backlog: "lifecycle = 'closed' and odoo_status <> 'entered'",
});

function operationsProjectionSql() {
  return `
    with operation_base as (
      select
        wo.id,
        wo.company_uuid as company_id,
        wo.serial,
        wo.location_id,
        wo.current_mechanic_id,
        coalesce(team.mechanic_ids, '{}'::uuid[]) as mechanic_ids,
        wo.status as lifecycle,
        wo.concern,
        wo.work_performed,
        wo.closed_at,
        wo.created_at,
        greatest(
          wo.updated_at,
          coalesce(activity.last_chat_at, '-infinity'::timestamptz),
          coalesce(activity.last_status_at, '-infinity'::timestamptz),
          coalesce(activity.last_part_at, '-infinity'::timestamptz),
          coalesce(activity.last_attention_at, '-infinity'::timestamptz)
        ) as last_activity_at,
        coalesce(
          status_started.created_at,
          case wo.status
            when 'open' then wo.created_at
            when 'accepted' then wo.accepted_at
            when 'in_progress' then wo.started_at
            when 'mechanic_done' then wo.mechanic_done_at
            when 'closed' then wo.closed_at
            when 'odoo_entered' then oes.entered_at
          end,
          wo.updated_at,
          wo.created_at
        ) as status_started_at,
        jsonb_build_object('id', l.id, 'name', l.name, 'type', l.type, 'address', l.address) as location,
        jsonb_build_object(
          'id', a.id,
          'unitNo', coalesce(a.unit_no, nullif(wo.form_data->>'unitNo', '')),
          'name', a.name,
          'unitType', coalesce(a.unit_type, nullif(wo.form_data->>'unitType', '')),
          'vin', coalesce(a.vin, nullif(wo.form_data->>'vinNo', '')),
          'licensePlate', coalesce(a.license_plate, nullif(wo.form_data->>'licenseNo', '')),
          'model', coalesce(a.model, nullif(wo.form_data->>'model', ''))
        ) as asset,
        jsonb_build_object('id', m.id, 'name', m.name, 'email', m.email) as mechanic,
        coalesce(team.mechanics, '[]'::jsonb) as mechanics,
        coalesce(oes.status, 'not_entered') as odoo_status,
        coalesce(oes.odoo_service_order_no, '') as odoo_service_order_no,
        coalesce(read_state.last_read_at, '-infinity'::timestamptz) as last_read_at,
        exists (
          select 1
          from workorder_part_requests request
          where request.workorder_id = wo.id
            and request.approval_status in ('submitted', 'needs_info')
        ) as needs_parts,
        exists (
          select 1
          from workorder_attention_state attention
          where attention.workorder_id = wo.id
            and attention.reason = 'office_help'
            and attention.active = true
        ) as needs_office_help,
        (
          coalesce(oes.status, 'not_entered') = 'missing_info'
          or exists (
            select 1
            from workorder_attention_state attention
            where attention.workorder_id = wo.id
              and attention.reason = 'missing_info'
              and attention.active = true
          )
        ) as missing_info
      from operational_workorders wo
      left join assets a on a.id = wo.asset_id
      left join locations l on l.id = wo.location_id
      left join app_users m on m.id = wo.current_mechanic_id
      left join lateral (
        select
          array_agg(assignment.mechanic_user_id) as mechanic_ids,
          jsonb_agg(
            jsonb_build_object(
              'id', member.id,
              'name', member.name,
              'email', member.email,
              'assignmentRole', assignment.assignment_role
            )
            order by case assignment.assignment_role when 'primary' then 0 else 1 end, member.name
          ) as mechanics
        from workorder_mechanic_assignments assignment
        join app_users member on member.id = assignment.mechanic_user_id
        where assignment.workorder_id = wo.id
          and assignment.active = true
      ) team on true
      left join odoo_entry_status oes on oes.workorder_id = wo.id
      left join workorder_read_state read_state
        on read_state.workorder_id = wo.id and read_state.user_id = $1::uuid
      left join lateral (
        select
          (select max(created_at) from chat_messages where workorder_id = wo.id) as last_chat_at,
          (select max(created_at) from workorder_status_events where workorder_id = wo.id) as last_status_at,
          (select max(created_at) from part_request_events where workorder_id = wo.id) as last_part_at,
          (select max(created_at) from workorder_attention_events where workorder_id = wo.id) as last_attention_at
      ) activity on true
      left join lateral (
        select max(created_at) as created_at
        from workorder_status_events
        where workorder_id = wo.id and to_status = wo.status
      ) status_started on true
    ), operations as (
      select
        operation_base.*,
        extract(epoch from (now() - created_at))::bigint as age_seconds,
        extract(epoch from (now() - status_started_at))::bigint as time_in_status_seconds,
        last_activity_at > last_read_at as is_unread,
        array_remove(array[
          case when needs_parts then 'parts' end,
          case when needs_office_help then 'office_help' end,
          case when missing_info then 'missing_info' end,
          case when (
            (lifecycle = 'open' and status_started_at < now() - interval '24 hours')
            or (lifecycle in ('accepted', 'in_progress') and status_started_at < now() - interval '8 hours')
            or (lifecycle = 'mechanic_done' and status_started_at < now() - interval '24 hours')
          ) then 'overdue' end
        ], null)::text[] as attention_reasons
      from operation_base
    )
  `;
}

function buildOperationsWhere(input, { includeCategory = true } = {}) {
  const values = [input.viewerUserId || null];
  const clauses = ["true"];
  const add = (sql, value) => {
    values.push(value);
    clauses.push(sql.replace("?", `$${values.length}`));
  };

  if (input.companyIds?.length) add("company_id = any(?::uuid[])", input.companyIds);
  if (input.locationIds?.length) add("location_id = any(?::uuid[])", input.locationIds);
  if (input.lifecycle?.length) add("lifecycle = any(?::text[])", input.lifecycle);
  if (input.attentionReason) add("?::text = any(attention_reasons)", input.attentionReason);
  if (input.mechanicId) add("?::uuid = any(mechanic_ids)", input.mechanicId);
  if (input.search) {
    add(`(
      serial ilike '%' || ? || '%'
      or concern ilike '%' || $${values.length + 1} || '%'
      or coalesce(asset->>'unitNo', asset->>'name', '') ilike '%' || $${values.length + 1} || '%'
      or coalesce(asset->>'vin', '') ilike '%' || $${values.length + 1} || '%'
      or coalesce(mechanic->>'name', '') ilike '%' || $${values.length + 1} || '%'
      or coalesce(mechanics::text, '') ilike '%' || $${values.length + 1} || '%'
      or coalesce(location->>'name', '') ilike '%' || $${values.length + 1} || '%'
    )`, input.search);
  }
  if (input.visibility === "mechanic") {
    add("(?::uuid = any(mechanic_ids) or (lifecycle = 'open' and cardinality(mechanic_ids) = 0))", input.actorUserId);
  } else if (input.visibility === "surveillance") {
    clauses.push("lifecycle in ('closed', 'odoo_entered')");
  }
  if (includeCategory) clauses.push(OPERATIONS_CATEGORY[input.category] || OPERATIONS_CATEGORY.all);
  return { sql: clauses.join("\n and "), values };
}

function publicOperationRow(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    serial: row.serial,
    locationId: row.location_id,
    location: emptyObjectToNull(row.location),
    asset: emptyObjectToNull(row.asset),
    concern: row.concern,
    workPerformed: row.work_performed,
    closedAt: row.closed_at,
    mechanic: emptyObjectToNull(row.mechanic),
    mechanicId: row.current_mechanic_id,
    mechanics: Array.isArray(row.mechanics) ? row.mechanics : [],
    mechanicIds: Array.isArray(row.mechanic_ids) ? row.mechanic_ids : [],
    lifecycle: row.lifecycle,
    attentionReasons: row.attention_reasons || [],
    odooStatus: row.odoo_status,
    odooServiceOrderNo: row.odoo_service_order_no,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    ageSeconds: Number(row.age_seconds || 0),
    timeInStatusSeconds: Number(row.time_in_status_seconds || 0),
    unread: Boolean(row.is_unread),
  };
}

export async function queryOperationalWorkorders(input = {}) {
  const page = Math.max(1, Number(input.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(input.pageSize) || 50));
  const direction = input.sortDirection === "asc" ? "asc" : "desc";
  const sort = OPERATIONS_SORT[input.sortBy] || OPERATIONS_SORT.lastActivityAt;
  const where = buildOperationsWhere(input);
  const limitIndex = where.values.length + 1;
  const offsetIndex = where.values.length + 2;
  const result = await query(
    `
      ${operationsProjectionSql()}
      select operations.*, count(*) over()::integer as total_count
      from operations
      where ${where.sql}
      order by ${sort} ${direction}, id asc
      limit $${limitIndex} offset $${offsetIndex}
    `,
    [...where.values, pageSize, (page - 1) * pageSize],
  );
  const total = Number(result.rows[0]?.total_count || 0);
  return {
    items: result.rows.map(publicOperationRow),
    page,
    pageSize,
    total,
    pageCount: Math.ceil(total / pageSize),
  };
}

export async function summarizeOperationalWorkorders(input = {}) {
  const where = buildOperationsWhere(input, { includeCategory: false });
  const result = await query(
    `
      ${operationsProjectionSql()}
      select
        count(*)::integer as all_count,
        count(*) filter (where cardinality(attention_reasons) > 0)::integer as needs_attention_count,
        count(*) filter (where lifecycle = 'open' and cardinality(mechanic_ids) = 0)::integer as unassigned_count,
        count(*) filter (where lifecycle in ('accepted', 'in_progress'))::integer as active_count,
        count(*) filter (where 'parts' = any(attention_reasons))::integer as parts_count,
        count(*) filter (where lifecycle = 'mechanic_done')::integer as ready_review_count,
        count(*) filter (where lifecycle = 'closed' and odoo_status <> 'entered')::integer as odoo_backlog_count
      from operations
      where ${where.sql}
    `,
    where.values,
  );
  const row = result.rows[0] || {};
  return {
    needsAttention: Number(row.needs_attention_count || 0),
    unassigned: Number(row.unassigned_count || 0),
    active: Number(row.active_count || 0),
    parts: Number(row.parts_count || 0),
    readyReview: Number(row.ready_review_count || 0),
    odooBacklog: Number(row.odoo_backlog_count || 0),
    all: Number(row.all_count || 0),
  };
}

export async function getOperationalWorkorderById(id) {
  const result = await query(
    `
      ${workorderSelect()}
      where wo.id = $1
      limit 1
    `,
    [id]
  );
  return publicWorkorderRow(result.rows[0]);
}

export async function recordWorkorderOpened({ workorderId, userId, actorRole }) {
  const result = await query(
    `
      insert into workorder_access_events (workorder_id, user_id, actor_role, event_type)
      select $1, $2, $3, 'opened'
      where not exists (
        select 1
        from workorder_access_events
        where workorder_id = $1
          and user_id = $2
          and event_type = 'opened'
          and created_at > now() - interval '30 seconds'
      )
      returning id
    `,
    [workorderId, userId, actorRole]
  );
  return Boolean(result.rows[0]);
}

export async function getWorkorderTimeline(workorderId) {
  const result = await query(
    `
      select *
      from (
        select
          se.id,
          'status' as type,
          se.from_status,
          se.to_status,
          null::uuid as from_mechanic_id,
          null::uuid as to_mechanic_id,
          null::text as action,
          se.note,
          u.name as changed_by_name,
          se.changed_by_user_id as actor_user_id,
          u.role as actor_role,
          null::text as from_mechanic_name,
          null::text as to_mechanic_name,
          se.created_at,
          null::text as field_key,
          null::text as field_label,
          null::text as old_value,
          null::text as new_value
        from workorder_status_events se
        left join app_users u on u.id = se.changed_by_user_id
        where se.workorder_id = $1
        union all
        select
          ae.id,
          'assignment' as type,
          null::text as from_status,
          null::text as to_status,
          ae.from_mechanic_id,
          ae.to_mechanic_id,
          ae.action,
          ae.reason as note,
          u.name as changed_by_name,
          ae.changed_by_user_id as actor_user_id,
          u.role as actor_role,
          fm.name as from_mechanic_name,
          tm.name as to_mechanic_name,
          ae.created_at,
          null::text as field_key,
          null::text as field_label,
          null::text as old_value,
          null::text as new_value
        from workorder_assignment_events ae
        left join app_users u on u.id = ae.changed_by_user_id
        left join app_users fm on fm.id = ae.from_mechanic_id
        left join app_users tm on tm.id = ae.to_mechanic_id
        where ae.workorder_id = $1
        union all
        select
          fe.id,
          'field' as type,
          null::text as from_status,
          null::text as to_status,
          null::uuid as from_mechanic_id,
          null::uuid as to_mechanic_id,
          fe.field_key as action,
          concat(fe.field_label, ' changed') as note,
          u.name as changed_by_name,
          fe.changed_by_user_id as actor_user_id,
          u.role as actor_role,
          null::text as from_mechanic_name,
          null::text as to_mechanic_name,
          fe.created_at,
          fe.field_key,
          fe.field_label,
          fe.old_value,
          fe.new_value
        from workorder_field_events fe
        left join app_users u on u.id = fe.changed_by_user_id
        where fe.workorder_id = $1
        union all
        select
          pe.id,
          'part' as type,
          null::text as from_status,
          null::text as to_status,
          null::uuid as from_mechanic_id,
          null::uuid as to_mechanic_id,
          pe.event_type as action,
          pe.note,
          u.name as changed_by_name,
          pe.actor_user_id,
          u.role as actor_role,
          null::text as from_mechanic_name,
          null::text as to_mechanic_name,
          pe.created_at,
          null::text as field_key,
          'Part request'::text as field_label,
          null::text as old_value,
          null::text as new_value
        from part_request_events pe
        left join app_users u on u.id = pe.actor_user_id
        where pe.workorder_id = $1
        union all
        select
          attention.id,
          'attention' as type,
          null::text as from_status,
          null::text as to_status,
          null::uuid as from_mechanic_id,
          null::uuid as to_mechanic_id,
          attention.action,
          coalesce(
            nullif(attention.details->>'note', ''),
            case
              when attention.action = 'resolved' then replace(attention.reason, '_', ' ') || ' resolved.'
              else replace(attention.reason, '_', ' ') || ' needs attention.'
            end
          ) as note,
          u.name as changed_by_name,
          attention.actor_user_id,
          u.role as actor_role,
          null::text as from_mechanic_name,
          null::text as to_mechanic_name,
          attention.created_at,
          attention.reason as field_key,
          'Attention'::text as field_label,
          null::text as old_value,
          null::text as new_value
        from workorder_attention_events attention
        left join app_users u on u.id = attention.actor_user_id
        where attention.workorder_id = $1
        union all
        select
          access.id,
          'access' as type,
          null::text as from_status,
          null::text as to_status,
          null::uuid as from_mechanic_id,
          null::uuid as to_mechanic_id,
          access.event_type as action,
          'Opened workorder.' as note,
          u.name as changed_by_name,
          access.user_id as actor_user_id,
          access.actor_role,
          null::text as from_mechanic_name,
          null::text as to_mechanic_name,
          access.created_at,
          null::text as field_key,
          null::text as field_label,
          null::text as old_value,
          null::text as new_value
        from workorder_access_events access
        left join app_users u on u.id = access.user_id
        where access.workorder_id = $1
      ) timeline
      order by created_at asc
    `,
    [workorderId]
  );
  return result.rows;
}

export async function acceptOperationalWorkorder(workorderId, mechanicUserId) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await client.query(
      "select id, status, current_mechanic_id from operational_workorders where id = $1 for update",
      [workorderId]
    );
    const workorder = current.rows[0];
    if (!workorder) throw new Error("Workorder not found.");
    const assignments = await client.query(
      `select mechanic_user_id
       from workorder_mechanic_assignments
       where workorder_id = $1 and active = true
       for update`,
      [workorderId],
    );
    const mechanicIds = assignments.rows.map((row) => row.mechanic_user_id);
    if (mechanicIds.length && !mechanicIds.includes(mechanicUserId)) {
      throw new Error("This workorder was already accepted by another mechanic.");
    }
    if (!mechanicIds.includes(mechanicUserId)) {
      await client.query(
        `insert into workorder_mechanic_assignments (
           workorder_id, mechanic_user_id, assignment_role, assigned_by_user_id, reason
         ) values ($1, $2, 'primary', $2, 'Mechanic accepted work')`,
        [workorderId, mechanicUserId],
      );
    }
    const nextStatus = workorder.status === WORKORDER_STATUS.OPEN ? WORKORDER_STATUS.ACCEPTED : workorder.status;
    await client.query(
      `
        update operational_workorders
        set current_mechanic_id = $2,
            status = $3,
            accepted_at = coalesce(accepted_at, now()),
            updated_at = now()
        where id = $1
      `,
      [workorderId, mechanicUserId, nextStatus]
    );
    await addAssignmentEvent(client, {
      workorderId,
      fromMechanicId: workorder.current_mechanic_id,
      toMechanicId: mechanicUserId,
      action: "accepted",
      changedByUserId: mechanicUserId,
    });
    if (workorder.status !== nextStatus) {
      await addStatusEvent(client, {
        workorderId,
        fromStatus: workorder.status,
        toStatus: nextStatus,
        changedByUserId: mechanicUserId,
        note: "Mechanic accepted work.",
      });
    }
    await client.query("commit");
    return getOperationalWorkorderById(workorderId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function releaseOperationalWorkorder(workorderId, mechanicUserId, reason) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await client.query(
      "select id, status, current_mechanic_id from operational_workorders where id = $1 for update",
      [workorderId]
    );
    const workorder = current.rows[0];
    if (!workorder) throw new Error("Workorder not found.");
    const released = await client.query(
      `update workorder_mechanic_assignments
       set active = false, released_at = now(), reason = $3
       where workorder_id = $1 and mechanic_user_id = $2 and active = true
       returning assignment_role`,
      [workorderId, mechanicUserId, reason],
    );
    if (!released.rows[0]) throw new Error("Only an assigned mechanic can leave this workorder.");
    const remaining = await client.query(
      `select mechanic_user_id, assignment_role
       from workorder_mechanic_assignments
       where workorder_id = $1 and active = true
       order by case assignment_role when 'primary' then 0 else 1 end, assigned_at
       for update`,
      [workorderId],
    );
    let nextPrimaryId = remaining.rows.find((row) => row.assignment_role === "primary")?.mechanic_user_id || null;
    if (!nextPrimaryId && remaining.rows[0]) {
      nextPrimaryId = remaining.rows[0].mechanic_user_id;
      await client.query(
        "update workorder_mechanic_assignments set assignment_role = 'primary' where workorder_id = $1 and mechanic_user_id = $2 and active = true",
        [workorderId, nextPrimaryId],
      );
    }
    const nextStatus = nextPrimaryId ? workorder.status : WORKORDER_STATUS.OPEN;
    await client.query(
      `
        update operational_workorders
        set current_mechanic_id = $2,
            status = $3,
            updated_at = now()
        where id = $1
      `,
      [workorderId, nextPrimaryId, nextStatus]
    );
    await addAssignmentEvent(client, {
      workorderId,
      fromMechanicId: mechanicUserId,
      toMechanicId: null,
      action: "released",
      reason,
      changedByUserId: mechanicUserId,
    });
    if (workorder.status !== nextStatus) {
      await addStatusEvent(client, {
        workorderId,
        fromStatus: workorder.status,
        toStatus: nextStatus,
        changedByUserId: mechanicUserId,
        note: reason,
      });
    }
    await client.query("commit");
    return getOperationalWorkorderById(workorderId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateMechanicNotes(workorderId, mechanicUserId, input) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const beforeResult = await client.query(
      `select wo.*
       from operational_workorders wo
       where wo.id = $1
         and exists (
           select 1 from workorder_mechanic_assignments assignment
           where assignment.workorder_id = wo.id
             and assignment.mechanic_user_id = $2
             and assignment.active = true
         )
       for update of wo`,
      [workorderId, mechanicUserId]
    );
    const before = beforeResult.rows[0];
    if (!before) throw new Error("Workorder not found for this mechanic.");
    const nextInput = { diagnosis: input.diagnosis || "", workPerformed: input.workPerformed || "" };
    await client.query(
      `
        update operational_workorders
        set diagnosis = $3,
            work_performed = $4,
            status = case when status = 'accepted' then 'in_progress' else status end,
            started_at = coalesce(started_at, now()),
            updated_at = now()
        where id = $1
          and exists (
            select 1 from workorder_mechanic_assignments assignment
            where assignment.workorder_id = operational_workorders.id
              and assignment.mechanic_user_id = $2
              and assignment.active = true
          )
      `,
      [workorderId, mechanicUserId, nextInput.diagnosis, nextInput.workPerformed]
    );
    await addFieldEvents(client, { workorderId, changes: changedFields(before, nextInput), changedByUserId: mechanicUserId });
    await client.query("commit");
    return getOperationalWorkorderById(workorderId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateMechanicUsedParts(workorderId, mechanicUserId, parts) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const beforeResult = await client.query(
      "select * from operational_workorders where id = $1 for update",
      [workorderId]
    );
    const before = beforeResult.rows[0];
    if (!before) throw new Error("Workorder not found.");
    const assignment = await client.query(
      `select 1 from workorder_mechanic_assignments
       where workorder_id = $1 and mechanic_user_id = $2 and active = true`,
      [workorderId, mechanicUserId],
    );
    if (!assignment.rows[0]) throw new Error("Only an assigned mechanic can save used parts.");
    const terminalStatuses = [
      WORKORDER_STATUS.MECHANIC_DONE,
      WORKORDER_STATUS.CLOSED,
      WORKORDER_STATUS.ODOO_ENTERED,
      WORKORDER_STATUS.CANCELLED,
    ];
    if (terminalStatuses.includes(before.status)) throw new Error("Used parts cannot be changed on a completed workorder.");

    const formData = before.form_data || {};
    const approvedRequestParts = (Array.isArray(formData.parts) ? formData.parts : [])
      .filter((part) => part?.requestId);
    const nextFormData = {
      ...formData,
      parts: [...parts, ...approvedRequestParts],
    };
    const nextInput = { formData: nextFormData };
    const partsChanged = JSON.stringify(canonicalJson(formData.parts || [])) !== JSON.stringify(canonicalJson(nextFormData.parts));
    const changes = partsChanged ? changedFields(before, nextInput) : [];

    if (changes.length) {
      await client.query(
        `update operational_workorders
         set form_data = $3::jsonb,
             updated_at = now()
         where id = $1
           and exists (
             select 1 from workorder_mechanic_assignments assignment
             where assignment.workorder_id = operational_workorders.id
               and assignment.mechanic_user_id = $2
               and assignment.active = true
           )`,
        [workorderId, mechanicUserId, JSON.stringify(nextFormData)]
      );
      await addFieldEvents(client, { workorderId, changes, changedByUserId: mechanicUserId });
    }
    await client.query("commit");
    return getOperationalWorkorderById(workorderId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function markOperationalWorkorderDone(workorderId, mechanicUserId, input) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await client.query(
      "select id, status, current_mechanic_id from operational_workorders where id = $1 for update",
      [workorderId]
    );
    const workorder = current.rows[0];
    if (!workorder) throw new Error("Workorder not found.");
    const assignment = await client.query(
      `select 1 from workorder_mechanic_assignments
       where workorder_id = $1 and mechanic_user_id = $2 and active = true`,
      [workorderId, mechanicUserId],
    );
    if (!assignment.rows[0]) throw new Error("Only an assigned mechanic can mark this workorder done.");
    const beforeResult = await client.query("select * from operational_workorders where id = $1 for update", [workorderId]);
    const before = beforeResult.rows[0];
    const nextInput = { diagnosis: input.diagnosis || "", workPerformed: input.workPerformed || "" };
    await client.query(
      `
        update operational_workorders
        set diagnosis = $3,
            work_performed = $4,
            status = $5,
            mechanic_done_at = now(),
            updated_at = now()
        where id = $1
          and exists (
            select 1 from workorder_mechanic_assignments assignment
            where assignment.workorder_id = operational_workorders.id
              and assignment.mechanic_user_id = $2
              and assignment.active = true
          )
      `,
      [workorderId, mechanicUserId, nextInput.diagnosis, nextInput.workPerformed, WORKORDER_STATUS.MECHANIC_DONE]
    );
    await addFieldEvents(client, { workorderId, changes: changedFields(before, nextInput), changedByUserId: mechanicUserId });
    await addStatusEvent(client, {
      workorderId,
      fromStatus: workorder.status,
      toStatus: WORKORDER_STATUS.MECHANIC_DONE,
      changedByUserId: mechanicUserId,
      note: "Mechanic marked work done.",
    });
    await client.query("commit");
    return getOperationalWorkorderById(workorderId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeOperationalWorkorder(workorderId, officeUserId, note = "") {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await client.query("select id, status from operational_workorders where id = $1 for update", [workorderId]);
    const workorder = current.rows[0];
    if (!workorder) throw new Error("Workorder not found.");
    if (workorder.status !== WORKORDER_STATUS.MECHANIC_DONE) {
      throw new Error("Only workorders ready for office review can be closed.");
    }
    await client.query(
      `
        update operational_workorders
        set status = $2,
            closed_at = now(),
            updated_at = now()
        where id = $1
      `,
      [workorderId, WORKORDER_STATUS.CLOSED]
    );
    await client.query(
      `
        insert into odoo_entry_status (workorder_id)
        values ($1)
        on conflict (workorder_id) do nothing
      `,
      [workorderId]
    );
    await addStatusEvent(client, {
      workorderId,
      fromStatus: workorder.status,
      toStatus: WORKORDER_STATUS.CLOSED,
      changedByUserId: officeUserId,
      note: note || "Office closed workorder.",
    });
    await client.query("commit");
    return getOperationalWorkorderById(workorderId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function setOperationalWorkorderMechanics(workorderId, officeUserId, mechanicUserIds, reason) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await client.query(
      "select id, status, current_mechanic_id from operational_workorders where id = $1 for update",
      [workorderId]
    );
    const workorder = current.rows[0];
    if (!workorder) throw new Error("Workorder not found.");
    const active = await client.query(
      `select mechanic_user_id, assignment_role
       from workorder_mechanic_assignments
       where workorder_id = $1 and active = true
       order by case assignment_role when 'primary' then 0 else 1 end, assigned_at
       for update`,
      [workorderId],
    );
    const currentIds = active.rows.map((row) => row.mechanic_user_id);
    const targetIds = [...new Set(mechanicUserIds)];
    const addedIds = targetIds.filter((id) => !currentIds.includes(id));
    const removedIds = currentIds.filter((id) => !targetIds.includes(id));
    const currentPrimaryId = active.rows.find((row) => row.assignment_role === "primary")?.mechanic_user_id
      || workorder.current_mechanic_id;
    const nextPrimaryId = targetIds.includes(currentPrimaryId) ? currentPrimaryId : targetIds[0] || null;

    if (!addedIds.length && !removedIds.length && currentPrimaryId === nextPrimaryId) {
      throw new Error("Select a different mechanic team before updating the assignment.");
    }

    if (removedIds.length) {
      await client.query(
        `update workorder_mechanic_assignments
         set active = false, released_at = now(), reason = $3
         where workorder_id = $1 and mechanic_user_id = any($2::uuid[]) and active = true`,
        [workorderId, removedIds, reason],
      );
    }
    await client.query(
      `update workorder_mechanic_assignments
       set assignment_role = 'support'
       where workorder_id = $1 and active = true`,
      [workorderId],
    );
    for (const mechanicUserId of addedIds) {
      await client.query(
        `insert into workorder_mechanic_assignments (
           workorder_id, mechanic_user_id, assignment_role, assigned_by_user_id, reason
         ) values ($1, $2, 'support', $3, $4)`,
        [workorderId, mechanicUserId, officeUserId, reason],
      );
    }
    if (nextPrimaryId) {
      await client.query(
        `update workorder_mechanic_assignments
         set assignment_role = 'primary'
         where workorder_id = $1 and mechanic_user_id = $2 and active = true`,
        [workorderId, nextPrimaryId],
      );
    }

    const nextStatus = nextPrimaryId
      ? (workorder.status === WORKORDER_STATUS.OPEN ? WORKORDER_STATUS.ACCEPTED : workorder.status)
      : WORKORDER_STATUS.OPEN;
    await client.query(
      `
        update operational_workorders
        set current_mechanic_id = $2,
            status = $3,
            accepted_at = case when $2::uuid is null then accepted_at else coalesce(accepted_at, now()) end,
            updated_at = now()
        where id = $1
      `,
      [workorderId, nextPrimaryId, nextStatus]
    );
    for (const mechanicUserId of removedIds) {
      await addAssignmentEvent(client, {
        workorderId,
        fromMechanicId: mechanicUserId,
        toMechanicId: null,
        action: "unassigned",
        reason,
        changedByUserId: officeUserId,
      });
    }
    for (const mechanicUserId of addedIds) {
      await addAssignmentEvent(client, {
        workorderId,
        fromMechanicId: null,
        toMechanicId: mechanicUserId,
        action: "reassigned",
        reason,
        changedByUserId: officeUserId,
      });
    }
    if (!addedIds.length && !removedIds.length && currentPrimaryId !== nextPrimaryId) {
      await addAssignmentEvent(client, {
        workorderId,
        fromMechanicId: currentPrimaryId,
        toMechanicId: nextPrimaryId,
        action: "taken_over",
        reason,
        changedByUserId: officeUserId,
      });
    }
    if (workorder.status !== nextStatus) {
      await addStatusEvent(client, {
        workorderId,
        fromStatus: workorder.status,
        toStatus: nextStatus,
        changedByUserId: officeUserId,
        note: reason,
      });
    }
    await client.query("commit");
    return getOperationalWorkorderById(workorderId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function reassignOperationalWorkorder(workorderId, officeUserId, mechanicUserId, reason) {
  return setOperationalWorkorderMechanics(
    workorderId,
    officeUserId,
    mechanicUserId ? [mechanicUserId] : [],
    reason,
  );
}
