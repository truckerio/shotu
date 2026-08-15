import { getPool, query } from "../pool.js";
import { DEFAULT_COMPANY_ID } from "../company.js";
import { reserveWorkorderSerials } from "./serial-counters.repo.js";
import { WORKORDER_STATUS } from "../../modules/workorders/workorder.constants.js";
import { OPERATIONS_ACTIVE_LIFECYCLES } from "../../modules/workorders/workorder-lifecycle-policy.js";
import { normalizeWorkorderFormData } from "../../../../shared/workorder-template.js";
import { resolveWorkPerformed } from "../../../../shared/workorder-completion.js";
import { publicOdooRecordUrl } from "../../integrations/odoo/odoo.navigation.js";

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
      'ownerName', ${alias}.owner_name,
      'lastLocation', ${alias}.last_location,
      'lastSeenAt', ${alias}.last_seen_at
    )
  `;
}

function workorderSelect() {
  return `
    select
      wo.id,
      wo.company_id,
      wo.serial,
      wo.asset_id,
      wo.location_id,
      wo.created_by_user_id,
      team.primary_mechanic_id,
      wo.status,
      wo.concern,
      wo.diagnosis,
      wo.work_performed,
      wo.progress_version,
      wo.office_notes,
      wo.form_data,
      wo.accepted_at,
      wo.started_at,
      wo.mechanic_done_at,
      wo.closed_at,
      wo.approved_by_user_id,
      approver.display_name as approved_by_name,
      wo.cancelled_at,
      wo.cancelled_by_user_id,
      canceller.display_name as cancelled_by_name,
      wo.cancel_reason,
      wo.created_at,
      wo.updated_at,
      coalesce(oes.status, 'not_entered') as odoo_status,
      coalesce(oes.odoo_service_order_no, '') as odoo_service_order_no,
      coalesce(oes.external_id, '') as odoo_external_id,
      coalesce(odoo_link.base_url, '') as odoo_base_url,
      coalesce(odoo_link.target_model, 'sale.order') as odoo_target_model,
      coalesce(odoo_link.service_action_external_id, '') as odoo_service_action_external_id,
      ${publicAssetSelect("a")} as asset,
      jsonb_build_object('id', l.id, 'name', l.name, 'type', l.type, 'address', l.address) as location,
      team.primary_mechanic as mechanic,
      coalesce(team.mechanics, '[]'::jsonb) as mechanics,
      coalesce(team.mechanic_ids, '{}'::uuid[]) as mechanic_ids
    from operational_workorders wo
    left join assets a on a.id = wo.asset_id
    left join locations l on l.id = wo.location_id
    left join user_profiles approver on approver.id = wo.approved_by_user_id
    left join user_profiles canceller on canceller.id = wo.cancelled_by_user_id
    left join odoo_entry_status oes on oes.workorder_id = wo.id
    left join lateral (
      select
        credential.metadata->>'baseUrl' as base_url,
        outbound.target_model,
        case
          when settings.service_action_base_url = regexp_replace(coalesce(credential.metadata->>'baseUrl', ''), '/+$', '')
           and settings.service_action_database = coalesce(credential.metadata->>'database', '')
          then settings.service_action_external_id
          else ''
        end as service_action_external_id
      from odoo_outbound_orders outbound
      join odoo_service_order_settings settings
        on settings.company_id = outbound.company_id
       and settings.integration_account_id = outbound.integration_account_id
       and settings.active = true
      join integration_credentials credential
        on credential.company_id = outbound.company_id
       and credential.integration_account_id = outbound.integration_account_id
       and credential.provider = 'odoo'
       and credential.credential_kind = 'api'
      where outbound.company_id = wo.company_id
        and outbound.workorder_id = wo.id
        and outbound.state = 'exported'
      order by outbound.updated_at desc
      limit 1
    ) odoo_link on true
    left join lateral (
      select
        jsonb_agg(
          jsonb_build_object(
            'id', member.id,
            'name', member.display_name,
            'email', member.contact_email,
            'role', 'mechanic',
            'assignmentRole', assignment.assignment_role,
            'assignedAt', assignment.assigned_at
          )
          order by case assignment.assignment_role when 'primary' then 0 else 1 end, member.display_name
        ) as mechanics,
        array_agg(assignment.mechanic_user_id) as mechanic_ids,
        (array_agg(assignment.mechanic_user_id order by assignment.assigned_at)
          filter (where assignment.assignment_role = 'primary'))[1] as primary_mechanic_id,
        (array_agg(
          jsonb_build_object(
            'id', member.id,
            'name', member.display_name,
            'email', member.contact_email,
            'role', 'mechanic'
          )
          order by assignment.assigned_at
        ) filter (where assignment.assignment_role = 'primary'))[1] as primary_mechanic
      from workorder_mechanic_assignments assignment
      join user_profiles member on member.id = assignment.mechanic_user_id
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
  const asset = emptyObjectToNull(row.asset);
  return {
    id: row.id,
    companyId: row.company_id,
    serial: row.serial,
    assetId: row.asset_id,
    locationId: row.location_id,
    createdByUserId: row.created_by_user_id,
    currentMechanicId: row.primary_mechanic_id,
    status: row.status,
    concern: row.concern,
    diagnosis: row.diagnosis,
    workPerformed: row.work_performed,
    progressVersion: row.progress_version || 1,
    officeNotes: row.office_notes,
    formData: normalizeWorkorderFormData(row.form_data, {
      assetOwnerName: asset?.ownerName,
    }),
    acceptedAt: row.accepted_at,
    startedAt: row.started_at,
    mechanicDoneAt: row.mechanic_done_at,
    closedAt: row.closed_at,
    approvedByUserId: row.approved_by_user_id,
    approvedByName: row.approved_by_name || "",
    approvedBy: row.approved_by_user_id ? { id: row.approved_by_user_id, name: row.approved_by_name || "" } : null,
    cancelledAt: row.cancelled_at,
    cancelledByUserId: row.cancelled_by_user_id,
    cancelledByName: row.cancelled_by_name || "",
    cancelReason: row.cancel_reason || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    odooStatus: row.odoo_status || "not_entered",
    odooServiceOrderNo: row.odoo_service_order_no || "",
    odooExternalId: row.odoo_external_id || "",
    odooUrl: publicOdooRecordUrl({
      baseUrl: row.odoo_base_url,
      externalId: row.odoo_external_id,
      model: row.odoo_target_model,
      actionId: row.odoo_service_action_external_id,
    }),
    asset,
    location: emptyObjectToNull(row.location),
    mechanic: emptyObjectToNull(row.mechanic),
    mechanics: Array.isArray(row.mechanics) ? row.mechanics : [],
    mechanicIds: Array.isArray(row.mechanic_ids) ? row.mechanic_ids : [],
  };
}

export class WorkorderLifecycleConflictError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkorderLifecycleConflictError";
    this.statusCode = 409;
    this.code = code;
  }
}

function lifecycleConflict(code, message) {
  return new WorkorderLifecycleConflictError(code, message);
}

const ACTIVE_ASSET_CONSTRAINT = "operational_workorders_one_active_per_asset_uidx";

function mapActiveAssetConflict(error) {
  if (error?.code === "23505" && error?.constraint === ACTIVE_ASSET_CONSTRAINT) {
    return lifecycleConflict(
      "ASSET_ACTIVE_WORKORDER_EXISTS",
      "This unit already has an active workorder. Close or cancel it before creating another.",
    );
  }
  return error;
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

async function setAttentionInTransaction(client, {
  workorderId,
  reason,
  active,
  actorUserId,
  details = {},
}) {
  const existing = await client.query(
    `select id, active from workorder_attention_state
     where workorder_id = $1 and reason = $2 for update`,
    [workorderId, reason],
  );
  const previous = existing.rows[0];
  const action = active
    ? previous?.active === false ? "reopened" : previous ? "updated" : "opened"
    : "resolved";
  await client.query(
    `insert into workorder_attention_state (
       workorder_id, reason, active, details, opened_by_user_id,
       resolved_by_user_id, resolved_at, updated_at
     ) values ($1, $2, $3, $4::jsonb, $5::uuid,
       case when $3 then null::uuid else $5::uuid end,
       case when $3 then null else now() end, now())
     on conflict (workorder_id, reason) do update
     set active = excluded.active,
         details = excluded.details,
         opened_by_user_id = case
           when excluded.active then coalesce(workorder_attention_state.opened_by_user_id, excluded.opened_by_user_id)
           else workorder_attention_state.opened_by_user_id
         end,
         opened_at = case
           when excluded.active and workorder_attention_state.active = false then now()
           else workorder_attention_state.opened_at
         end,
         resolved_by_user_id = excluded.resolved_by_user_id,
         resolved_at = excluded.resolved_at,
         updated_at = now()`,
    [workorderId, reason, active, JSON.stringify(details), actorUserId || null],
  );
  if (!previous || previous.active !== active || action === "updated") {
    await client.query(
      `insert into workorder_attention_events (workorder_id, reason, action, actor_user_id, details)
       values ($1, $2, $3, $4::uuid, $5::jsonb)`,
      [workorderId, reason, action, actorUserId || null, JSON.stringify(details)],
    );
  }
}

const INITIAL_ASSIGNMENT_REASON = "Assigned when workorder was created.";

async function validateInitialMechanics(client, {
  mechanicUserIds,
  companyId,
  locationId,
}) {
  if (!mechanicUserIds.length) return;
  if (mechanicUserIds.length > 10) throw new Error("A workorder can have up to 10 mechanics.");
  if (!locationId) throw new Error("Select a location before assigning mechanics.");

  const assignable = await client.query(
    `select membership.user_id
       from user_location_memberships membership
       join user_company_memberships company_membership
         on company_membership.user_id = membership.user_id
        and company_membership.company_id = membership.company_id
        and company_membership.role = 'mechanic'
        and company_membership.active = true
       join user_profiles profile
         on profile.id = membership.user_id
        and profile.active = true
        and profile.deleted_at is null
      where membership.location_id = $1
        and membership.company_id = $2
        and membership.active = true
        and membership.user_id = any($3::uuid[])`,
    [locationId, companyId, mechanicUserIds],
  );
  const assignableIds = new Set(assignable.rows.map((row) => row.user_id));
  if (mechanicUserIds.some((id) => !assignableIds.has(id))) {
    throw new Error("Every selected mechanic must be active at this workorder location.");
  }
}

async function addInitialMechanicAssignments(client, {
  workorderId,
  mechanicUserIds,
  assignedByUserId,
}) {
  for (const [index, mechanicUserId] of mechanicUserIds.entries()) {
    await client.query(
      `insert into workorder_mechanic_assignments (
         workorder_id, mechanic_user_id, assignment_role, assigned_by_user_id, reason
       ) values ($1, $2, $3, $4, $5)`,
      [
        workorderId,
        mechanicUserId,
        index === 0 ? "primary" : "support",
        assignedByUserId || null,
        INITIAL_ASSIGNMENT_REASON,
      ],
    );
    await addAssignmentEvent(client, {
      workorderId,
      fromMechanicId: null,
      toMechanicId: mechanicUserId,
      action: "reassigned",
      reason: INITIAL_ASSIGNMENT_REASON,
      changedByUserId: assignedByUserId,
    });
  }
}

const FIELD_EVENT_LABELS = {
  assetId: "Asset",
  locationId: "Location",
  concern: "Concern",
  diagnosis: "Diagnosis",
  workPerformed: "Work performed",
  officeNotes: "Office notes",
  "formData.customerCompanyName": "Customer company",
  "formData.companyName": "Customer company (legacy)",
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
  "formData.laborHours": "Labor hours",
};

const MECHANIC_OWNED_FORM_KEYS = new Set([
  "mechanicName",
  "startTime",
  "endTime",
  "parts",
]);

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

function preserveMechanicOwnedFormData(beforeFormData, proposedFormData) {
  const preserved = { ...(proposedFormData || {}) };
  for (const key of MECHANIC_OWNED_FORM_KEYS) {
    if (Object.prototype.hasOwnProperty.call(beforeFormData || {}, key)) preserved[key] = beforeFormData[key];
    else delete preserved[key];
  }
  return preserved;
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
      if (
        formKey === "companyName"
        && Object.prototype.hasOwnProperty.call(newForm, "customerCompanyName")
      ) continue;
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

export async function createOperationalWorkorderInTransaction(input, client) {
  const companyId = input.companyId || DEFAULT_COMPANY_ID;
  const mechanicUserIds = [...new Set(input.mechanicUserIds || [])];
  await validateInitialMechanics(client, {
    mechanicUserIds,
    companyId,
    locationId: input.locationId || null,
  });
  const assetOwnerResult = input.assetId
    ? await client.query(
      "select owner_name from assets where id = $1 and company_id = $2",
      [input.assetId, companyId],
    )
    : { rows: [] };
  const formData = normalizeWorkorderFormData(input.formData, {
    assetOwnerName: assetOwnerResult.rows[0]?.owner_name,
  });
  const reservation = await reserveWorkorderSerials({ companyId, count: 1 }, client);
  const serial = reservation.serials[0];
  const result = await client.query(
    `
      insert into operational_workorders (
        company_id, serial, asset_id, location_id, created_by_user_id, concern, office_notes, form_data,
        work_performed
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
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
      JSON.stringify(formData),
      formData.workPerformed || "",
    ]
  );
  await addStatusEvent(client, {
    workorderId: result.rows[0].id,
    toStatus: result.rows[0].status,
    changedByUserId: input.createdByUserId,
    note: "Workorder created.",
  });
  if (mechanicUserIds.length) {
    await addInitialMechanicAssignments(client, {
      workorderId: result.rows[0].id,
      mechanicUserIds,
      assignedByUserId: input.createdByUserId,
    });
    const assignedStatus = input.startImmediately
      ? WORKORDER_STATUS.IN_PROGRESS
      : WORKORDER_STATUS.ACCEPTED;
    await client.query(
      `update operational_workorders
          set status = $2,
              accepted_at = now(),
              started_at = case when $3::boolean then now() else null end,
              updated_at = now()
        where id = $1`,
      [result.rows[0].id, assignedStatus, input.startImmediately === true],
    );
    await addStatusEvent(client, {
      workorderId: result.rows[0].id,
      fromStatus: result.rows[0].status,
      toStatus: assignedStatus,
      changedByUserId: input.createdByUserId,
      note: input.startImmediately ? "Mechanic created and started workorder." : INITIAL_ASSIGNMENT_REASON,
    });
  }
  return { id: result.rows[0].id, serial };
}

export async function createOperationalWorkorder(input) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const created = await createOperationalWorkorderInTransaction(input, client);
    await client.query("commit");
    return getOperationalWorkorderById(created.id);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw mapActiveAssetConflict(error);
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
    if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== new Date(before.updated_at).getTime()) {
      throw lifecycleConflict("WORKORDER_STALE", "This workorder changed elsewhere. Reload before saving.");
    }
    if (
      Object.prototype.hasOwnProperty.call(input, "expectedVersion")
      && before.progress_version !== input.expectedVersion
    ) {
      throw lifecycleConflict(
        "WORKORDER_PROGRESS_VERSION_CONFLICT",
        "This workorder changed elsewhere. Reload before saving.",
      );
    }
    let canCorrectClosed = false;
    if (before.status === WORKORDER_STATUS.CLOSED) {
      const attention = await client.query(
        `select 1 from workorder_attention_state
         where workorder_id = $1 and reason = 'missing_info' and active = true`,
        [workorderId],
      );
      canCorrectClosed = Boolean(attention.rows[0]);
    }
    if (![WORKORDER_STATUS.OPEN, WORKORDER_STATUS.ACCEPTED, WORKORDER_STATUS.IN_PROGRESS, WORKORDER_STATUS.MECHANIC_DONE].includes(before.status)
      && !canCorrectClosed) {
      throw lifecycleConflict("WORKORDER_UPDATE_NOT_ALLOWED", "This workorder can no longer be edited.");
    }
    const nextAssetId = Object.prototype.hasOwnProperty.call(input, "assetId")
      ? input.assetId
      : before.asset_id;
    const assetOwnerResult = nextAssetId
      ? await client.query(
        "select owner_name from assets where id = $1 and company_id = $2",
        [nextAssetId, before.company_id],
      )
      : { rows: [] };
    const normalizedInput = input.formData === undefined
      ? input
      : {
        ...input,
        formData: normalizeWorkorderFormData(preserveMechanicOwnedFormData(before.form_data, input.formData), {
          assetOwnerName: assetOwnerResult.rows[0]?.owner_name,
        }),
      };
    const changes = changedFields(before, normalizedInput);
    await client.query(
      `
        update operational_workorders
        set asset_id = case when $2::boolean then $3::uuid else asset_id end,
            location_id = case when $4::boolean then $5::uuid else location_id end,
            concern = coalesce($6, concern),
            office_notes = coalesce($7, office_notes),
            form_data = coalesce($8::jsonb, form_data),
            diagnosis = case when $9::boolean then $10 else diagnosis end,
            work_performed = case when $11::boolean then $12 else work_performed end,
            progress_version = progress_version + case when $9::boolean or $11::boolean then 1 else 0 end,
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
        normalizedInput.formData === undefined ? null : JSON.stringify(normalizedInput.formData),
        Object.prototype.hasOwnProperty.call(input, "diagnosis"),
        input.diagnosis ?? "",
        Object.prototype.hasOwnProperty.call(input, "workPerformed"),
        input.workPerformed ?? "",
      ]
    );
    await addFieldEvents(client, { workorderId, changes, changedByUserId: input.changedByUserId });
    await client.query("commit");
    return getOperationalWorkorderById(workorderId);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw mapActiveAssetConflict(error);
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
        and ($4::uuid[] is null or wo.company_id = any($4::uuid[]))
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

function staticLifecycleSql(statuses) {
  return statuses.map((status) => `'${status}'`).join(", ");
}

const OPERATIONS_ACTIVE_LIFECYCLES_SQL = staticLifecycleSql(OPERATIONS_ACTIVE_LIFECYCLES);

const OPERATIONS_CATEGORY = Object.freeze({
  all: "true",
  needs_attention: "cardinality(attention_reasons) > 0",
  unassigned: "lifecycle = 'open' and cardinality(mechanic_ids) = 0",
  active: `lifecycle in (${OPERATIONS_ACTIVE_LIFECYCLES_SQL})`,
  parts: "'parts' = any(attention_reasons)",
  ready_review: "lifecycle = 'mechanic_done'",
  odoo_backlog: "lifecycle = 'closed' and odoo_status <> 'entered'",
});

function operationsProjectionSql() {
  return `
    with operation_base as (
      select
        wo.id,
        wo.company_id,
        wo.serial,
        wo.location_id,
        team.primary_mechanic_id,
        coalesce(team.mechanic_ids, '{}'::uuid[]) as mechanic_ids,
        wo.status as lifecycle,
        wo.concern,
        wo.work_performed,
        wo.closed_at,
        wo.cancelled_at,
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
            when 'cancelled' then wo.cancelled_at
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
        team.primary_mechanic as mechanic,
        coalesce(team.mechanics, '[]'::jsonb) as mechanics,
        coalesce(oes.status, 'not_entered') as odoo_status,
        coalesce(oes.odoo_service_order_no, '') as odoo_service_order_no,
        coalesce(read_state.last_read_at, '-infinity'::timestamptz) as last_read_at,
        coalesce(attention_summary.details, '{}'::jsonb) as attention_details,
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
      left join lateral (
        select
          array_agg(assignment.mechanic_user_id) as mechanic_ids,
          (array_agg(assignment.mechanic_user_id order by assignment.assigned_at)
            filter (where assignment.assignment_role = 'primary'))[1] as primary_mechanic_id,
          (array_agg(
            jsonb_build_object(
              'id', member.id,
              'name', member.display_name,
              'email', member.contact_email
            )
            order by assignment.assigned_at
          ) filter (where assignment.assignment_role = 'primary'))[1] as primary_mechanic,
          jsonb_agg(
            jsonb_build_object(
              'id', member.id,
              'name', member.display_name,
              'email', member.contact_email,
              'assignmentRole', assignment.assignment_role
            )
            order by case assignment.assignment_role when 'primary' then 0 else 1 end, member.display_name
          ) as mechanics
        from workorder_mechanic_assignments assignment
        join user_profiles member on member.id = assignment.mechanic_user_id
        where assignment.workorder_id = wo.id
          and assignment.active = true
      ) team on true
      left join odoo_entry_status oes on oes.workorder_id = wo.id
      left join workorder_read_state read_state
        on read_state.workorder_id = wo.id and read_state.user_id = $1::uuid
      left join lateral (
        select jsonb_object_agg(attention.reason, attention.details) as details
        from workorder_attention_state attention
        where attention.workorder_id = wo.id and attention.active = true
      ) attention_summary on true
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
          case when attention_details ? 'revision_requested' then 'revision_requested' end,
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
    if (input.mechanicPool) {
      clauses.push("lifecycle in ('accepted', 'in_progress')");
    } else {
      add("(?::uuid = any(mechanic_ids) or (lifecycle = 'open' and cardinality(mechanic_ids) = 0))", input.actorUserId);
    }
  } else if (input.visibility === "surveillance") {
    clauses.push("lifecycle in ('accepted', 'in_progress', 'mechanic_done', 'closed', 'odoo_entered')");
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
    cancelledAt: row.cancelled_at,
    mechanic: emptyObjectToNull(row.mechanic),
    mechanicId: row.primary_mechanic_id,
    mechanics: Array.isArray(row.mechanics) ? row.mechanics : [],
    mechanicIds: Array.isArray(row.mechanic_ids) ? row.mechanic_ids : [],
    lifecycle: row.lifecycle,
    attentionReasons: row.attention_reasons || [],
    attentionDetails: row.attention_details || {},
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
        count(*) filter (where lifecycle in (${OPERATIONS_ACTIVE_LIFECYCLES_SQL}))::integer as active_count,
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
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const current = await client.query(
      "select id, status, started_at from operational_workorders where id = $1 for update",
      [workorderId],
    );
    const workorder = current.rows[0];
    if (!workorder) throw new Error("Workorder not found.");
    let started = false;
    if (actorRole === "mechanic" && workorder.status === WORKORDER_STATUS.ACCEPTED && !workorder.started_at) {
      const assignment = await client.query(
        `select 1 from workorder_mechanic_assignments
         where workorder_id = $1 and mechanic_user_id = $2 and active = true`,
        [workorderId, userId],
      );
      if (assignment.rows[0]) {
        await client.query(
          `update operational_workorders
           set status = $2, started_at = now(), updated_at = now()
           where id = $1 and started_at is null`,
          [workorderId, WORKORDER_STATUS.IN_PROGRESS],
        );
        await addStatusEvent(client, {
          workorderId,
          fromStatus: workorder.status,
          toStatus: WORKORDER_STATUS.IN_PROGRESS,
          changedByUserId: userId,
          note: "Assigned mechanic opened and started work.",
        });
        started = true;
      }
    }
    const access = await client.query(
      `insert into workorder_access_events (workorder_id, user_id, actor_role, event_type)
       select $1, $2, $3, 'opened'
       where not exists (
         select 1 from workorder_access_events
         where workorder_id = $1 and user_id = $2 and event_type = 'opened'
           and created_at > now() - interval '30 seconds'
       )
       returning id`,
      [workorderId, userId, actorRole],
    );
    await client.query("commit");
    return {
      recorded: Boolean(access.rows[0]),
      started,
      workorder: started ? await getOperationalWorkorderById(workorderId) : undefined,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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
          u.display_name as changed_by_name,
          se.changed_by_user_id as actor_user_id,
          (select role from v_user_primary_role where user_id = u.id) as actor_role,
          null::text as from_mechanic_name,
          null::text as to_mechanic_name,
          se.created_at,
          null::text as field_key,
          null::text as field_label,
          null::text as old_value,
          null::text as new_value
        from workorder_status_events se
        left join user_profiles u on u.id = se.changed_by_user_id
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
          u.display_name as changed_by_name,
          ae.changed_by_user_id as actor_user_id,
          (select role from v_user_primary_role where user_id = u.id) as actor_role,
          fm.display_name as from_mechanic_name,
          tm.display_name as to_mechanic_name,
          ae.created_at,
          null::text as field_key,
          null::text as field_label,
          null::text as old_value,
          null::text as new_value
        from workorder_assignment_events ae
        left join user_profiles u on u.id = ae.changed_by_user_id
        left join user_profiles fm on fm.id = ae.from_mechanic_id
        left join user_profiles tm on tm.id = ae.to_mechanic_id
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
          u.display_name as changed_by_name,
          fe.changed_by_user_id as actor_user_id,
          (select role from v_user_primary_role where user_id = u.id) as actor_role,
          null::text as from_mechanic_name,
          null::text as to_mechanic_name,
          fe.created_at,
          fe.field_key,
          fe.field_label,
          fe.old_value,
          fe.new_value
        from workorder_field_events fe
        left join user_profiles u on u.id = fe.changed_by_user_id
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
          u.display_name as changed_by_name,
          pe.actor_user_id,
          (select role from v_user_primary_role where user_id = u.id) as actor_role,
          null::text as from_mechanic_name,
          null::text as to_mechanic_name,
          pe.created_at,
          null::text as field_key,
          'Part request'::text as field_label,
          null::text as old_value,
          null::text as new_value
        from part_request_events pe
        left join user_profiles u on u.id = pe.actor_user_id
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
          u.display_name as changed_by_name,
          attention.actor_user_id,
          (select role from v_user_primary_role where user_id = u.id) as actor_role,
          null::text as from_mechanic_name,
          null::text as to_mechanic_name,
          attention.created_at,
          attention.reason as field_key,
          'Attention'::text as field_label,
          null::text as old_value,
          null::text as new_value
        from workorder_attention_events attention
        left join user_profiles u on u.id = attention.actor_user_id
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
          u.display_name as changed_by_name,
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
        left join user_profiles u on u.id = access.user_id
        where access.workorder_id = $1
      ) timeline
      order by created_at asc, id asc
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
      "select id, status from operational_workorders where id = $1 for update",
      [workorderId]
    );
    const workorder = current.rows[0];
    if (!workorder) throw new Error("Workorder not found.");
    const assignments = await client.query(
      `select mechanic_user_id, assignment_role
       from workorder_mechanic_assignments
       where workorder_id = $1 and active = true
       for update`,
      [workorderId],
    );
    const mechanicIds = assignments.rows.map((row) => row.mechanic_user_id);
    const previousPrimaryId = assignments.rows.find((row) => row.assignment_role === "primary")?.mechanic_user_id || null;
    if (workorder.status !== WORKORDER_STATUS.OPEN || mechanicIds.length) {
      throw lifecycleConflict("WORKORDER_ALREADY_ACCEPTED", "This workorder has already been accepted.");
    }
    await client.query(
      `insert into workorder_mechanic_assignments (
         workorder_id, mechanic_user_id, assignment_role, assigned_by_user_id, reason
       ) values ($1, $2, 'primary', $2, 'Mechanic accepted work')`,
      [workorderId, mechanicUserId],
    );
    const nextStatus = WORKORDER_STATUS.IN_PROGRESS;
    await client.query(
      `
        update operational_workorders
        set status = $2,
            accepted_at = coalesce(accepted_at, now()),
            started_at = coalesce(started_at, now()),
            updated_at = now()
        where id = $1
      `,
      [workorderId, nextStatus]
    );
    await addAssignmentEvent(client, {
      workorderId,
      fromMechanicId: previousPrimaryId,
      toMechanicId: mechanicUserId,
      action: "accepted",
      reason: mechanicIds.length ? "Joined active work." : "",
      changedByUserId: mechanicUserId,
    });
    await addStatusEvent(client, {
      workorderId,
      fromStatus: workorder.status,
      toStatus: nextStatus,
      changedByUserId: mechanicUserId,
      note: "Mechanic accepted and started work.",
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

export async function releaseOperationalWorkorder(workorderId, mechanicUserId, reason) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await client.query(
      "select id, status from operational_workorders where id = $1 for update",
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
        set status = $2,
            updated_at = now()
        where id = $1
      `,
      [workorderId, nextStatus]
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

async function updateOperationalUsedParts(workorderId, changedByUserId, parts, laborHours, {
  requireAssignedMechanic = false,
} = {}) {
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
    if (requireAssignedMechanic) {
      const assignment = await client.query(
        `select 1 from workorder_mechanic_assignments
         where workorder_id = $1 and mechanic_user_id = $2 and active = true`,
        [workorderId, changedByUserId],
      );
      if (!assignment.rows[0]) throw new Error("Only an assigned mechanic can save used parts.");
      const terminalStatuses = [
        WORKORDER_STATUS.MECHANIC_DONE,
        WORKORDER_STATUS.CLOSED,
        WORKORDER_STATUS.ODOO_ENTERED,
        WORKORDER_STATUS.CANCELLED,
      ];
      if (terminalStatuses.includes(before.status)) throw new Error("Used parts cannot be changed on a completed workorder.");
    } else {
      let canEdit = [
        WORKORDER_STATUS.OPEN,
        WORKORDER_STATUS.ACCEPTED,
        WORKORDER_STATUS.IN_PROGRESS,
        WORKORDER_STATUS.MECHANIC_DONE,
      ].includes(before.status);
      if (before.status === WORKORDER_STATUS.CLOSED) {
        const attention = await client.query(
          `select 1 from workorder_attention_state
           where workorder_id = $1 and reason = 'missing_info' and active = true`,
          [workorderId],
        );
        canEdit = Boolean(attention.rows[0]);
      }
      if (!canEdit) {
        throw lifecycleConflict("WORKORDER_UPDATE_NOT_ALLOWED", "Used parts can no longer be changed on this workorder.");
      }
    }

    const formData = before.form_data || {};
    const nextFormData = {
      ...formData,
      parts,
      ...(laborHours !== undefined ? { laborHours } : {}),
    };
    const nextInput = { formData: nextFormData };
    const partsChanged = JSON.stringify(canonicalJson(formData.parts || [])) !== JSON.stringify(canonicalJson(nextFormData.parts));
    const laborChanged = laborHours !== undefined && String(formData.laborHours || "") !== String(laborHours || "");
    const changes = partsChanged || laborChanged ? changedFields(before, nextInput) : [];

    if (changes.length) {
      await client.query(
        `update operational_workorders
         set form_data = $3::jsonb,
             updated_at = now()
         where id = $1
           and ($4::boolean = false or exists (
             select 1 from workorder_mechanic_assignments assignment
             where assignment.workorder_id = operational_workorders.id
               and assignment.mechanic_user_id = $2
               and assignment.active = true
           ))`,
        [workorderId, changedByUserId, JSON.stringify(nextFormData), requireAssignedMechanic]
      );
      await addFieldEvents(client, { workorderId, changes, changedByUserId });
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

export function updateMechanicUsedParts(workorderId, mechanicUserId, parts, laborHours) {
  return updateOperationalUsedParts(workorderId, mechanicUserId, parts, laborHours, {
    requireAssignedMechanic: true,
  });
}

export function updateOfficeUsedParts(workorderId, officeUserId, parts, laborHours) {
  return updateOperationalUsedParts(workorderId, officeUserId, parts, laborHours);
}

export async function markOperationalWorkorderDone(
  workorderId,
  completedByUserId,
  input,
  { requireAssignedMechanic = true, statusNote = "Mechanic marked work done." } = {},
) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await client.query(
      "select id, status from operational_workorders where id = $1 for update",
      [workorderId]
    );
    const workorder = current.rows[0];
    if (!workorder) throw new Error("Workorder not found.");
    const eligibleStatuses = requireAssignedMechanic
      ? [WORKORDER_STATUS.ACCEPTED, WORKORDER_STATUS.IN_PROGRESS]
      : [WORKORDER_STATUS.OPEN, WORKORDER_STATUS.ACCEPTED, WORKORDER_STATUS.IN_PROGRESS];
    if (!eligibleStatuses.includes(workorder.status)) {
      throw lifecycleConflict("WORKORDER_NOT_ACTIVE", "Only active work can be marked done.");
    }
    if (requireAssignedMechanic) {
      const assignment = await client.query(
        `select 1 from workorder_mechanic_assignments
         where workorder_id = $1 and mechanic_user_id = $2 and active = true`,
        [workorderId, completedByUserId],
      );
      if (!assignment.rows[0]) throw new Error("Only an assigned mechanic can mark this workorder done.");
    }
    const beforeResult = await client.query("select * from operational_workorders where id = $1 for update", [workorderId]);
    const before = beforeResult.rows[0];
    const nextInput = {
      diagnosis: input.diagnosis || "",
      workPerformed: resolveWorkPerformed({
        workPerformed: input.workPerformed || before.work_performed,
        parts: before.form_data?.parts,
      }),
    };
    if (!nextInput.workPerformed) {
      throw lifecycleConflict(
        "WORKORDER_REPAIR_DETAILS_REQUIRED",
        "Add a repair order in Parts before marking Work done.",
      );
    }
    // Mark-done is an explicit terminal mutation, so it intentionally bypasses
    // expectedVersion while advancing the progress token atomically.
    await client.query(
      `
        update operational_workorders
        set diagnosis = $3,
            work_performed = $4,
            progress_version = progress_version + 1,
            progress_activity_version = progress_version + 1,
            progress_pending_fields = '[]'::jsonb,
            status = $5,
            started_at = coalesce(started_at, now()),
            mechanic_done_at = now(),
            updated_at = now()
        where id = $1
          and (
            $6::boolean = false
            or exists (
              select 1 from workorder_mechanic_assignments assignment
              where assignment.workorder_id = operational_workorders.id
                and assignment.mechanic_user_id = $2
                and assignment.active = true
            )
          )
      `,
      [
        workorderId,
        completedByUserId,
        nextInput.diagnosis,
        nextInput.workPerformed,
        WORKORDER_STATUS.MECHANIC_DONE,
        requireAssignedMechanic,
      ]
    );
    await addFieldEvents(client, { workorderId, changes: changedFields(before, nextInput), changedByUserId: completedByUserId });
    await addStatusEvent(client, {
      workorderId,
      fromStatus: workorder.status,
      toStatus: WORKORDER_STATUS.MECHANIC_DONE,
      changedByUserId: completedByUserId,
      note: statusNote,
    });
    const activeRevision = await client.query(
      `select 1 from workorder_attention_state
       where workorder_id = $1 and reason = 'revision_requested' and active = true`,
      [workorderId],
    );
    if (activeRevision.rows[0]) {
      await setAttentionInTransaction(client, {
        workorderId,
        reason: "revision_requested",
        active: false,
        actorUserId: completedByUserId,
        details: { note: "Requested changes completed." },
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

export async function returnOperationalWorkorder(workorderId, officeUserId, { reason, categories = [] }) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const current = await client.query(
      "select id, status, mechanic_done_at from operational_workorders where id = $1 for update",
      [workorderId],
    );
    const workorder = current.rows[0];
    if (!workorder) throw new Error("Workorder not found.");
    if (workorder.status !== WORKORDER_STATUS.MECHANIC_DONE) {
      throw lifecycleConflict("WORKORDER_RETURN_NOT_ALLOWED", "Only work ready for Manager review can be returned.");
    }
    await client.query(
      `update operational_workorders
       set status = $2, mechanic_done_at = null, updated_at = now()
       where id = $1`,
      [workorderId, WORKORDER_STATUS.IN_PROGRESS],
    );
    await addStatusEvent(client, {
      workorderId,
      fromStatus: workorder.status,
      toStatus: WORKORDER_STATUS.IN_PROGRESS,
      changedByUserId: officeUserId,
      note: `Changes requested: ${reason}`,
    });
    await setAttentionInTransaction(client, {
      workorderId,
      reason: "revision_requested",
      active: true,
      actorUserId: officeUserId,
      details: {
        note: reason,
        categories,
        previousMechanicDoneAt: workorder.mechanic_done_at,
      },
    });
    await client.query("commit");
    return getOperationalWorkorderById(workorderId);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelOperationalWorkorder(workorderId, officeUserId, reason) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const current = await client.query(
      "select id, status from operational_workorders where id = $1 for update",
      [workorderId],
    );
    const workorder = current.rows[0];
    if (!workorder) throw new Error("Workorder not found.");
    if (![WORKORDER_STATUS.OPEN, WORKORDER_STATUS.ACCEPTED, WORKORDER_STATUS.IN_PROGRESS, WORKORDER_STATUS.MECHANIC_DONE].includes(workorder.status)) {
      throw lifecycleConflict("WORKORDER_CANCELLATION_NOT_ALLOWED", "This workorder can no longer be cancelled.");
    }

    const assignments = await client.query(
      `select mechanic_user_id from workorder_mechanic_assignments
       where workorder_id = $1 and active = true for update`,
      [workorderId],
    );
    await client.query(
      `update workorder_mechanic_assignments
       set active = false, released_at = now(), reason = $2
       where workorder_id = $1 and active = true`,
      [workorderId, `Workorder cancelled: ${reason}`],
    );
    for (const assignment of assignments.rows) {
      await addAssignmentEvent(client, {
        workorderId,
        fromMechanicId: assignment.mechanic_user_id,
        toMechanicId: null,
        action: "unassigned",
        reason: `Workorder cancelled: ${reason}`,
        changedByUserId: officeUserId,
      });
    }

    const allocations = await client.query(
      `select allocation.id, allocation.part_request_id, allocation.status,
              allocation.inventory_item_id, allocation.quantity
       from part_allocations allocation
       join workorder_part_requests request on request.id = allocation.part_request_id
       where request.workorder_id = $1
         and allocation.status in ('proposed', 'reserved', 'ordered', 'received', 'transferred')
       for update of allocation`,
      [workorderId],
    );
    for (const allocation of allocations.rows) {
      if (allocation.status === "reserved" && allocation.inventory_item_id) {
        await client.query("select id from inventory_items where id = $1 for update", [allocation.inventory_item_id]);
        await client.query(
          `update inventory_items
           set quantity_reserved = quantity_reserved - $2, updated_at = now()
           where id = $1`,
          [allocation.inventory_item_id, allocation.quantity],
        );
      }
      await client.query(
        "update part_allocations set status = 'cancelled', updated_at = now() where id = $1",
        [allocation.id],
      );
    }
    const cancelledRequests = await client.query(
      `update workorder_part_requests
       set approval_status = 'cancelled', decision_reason = $2, updated_at = now()
       where workorder_id = $1 and approval_status in ('submitted', 'needs_info', 'approved')
       returning id`,
      [workorderId, `Workorder cancelled: ${reason}`],
    );
    for (const request of cancelledRequests.rows) {
      await client.query(
        `insert into part_request_events (
           workorder_id, part_request_id, event_type, actor_user_id, note, metadata
         ) values ($1, $2, 'cancelled', $3, $4, $5::jsonb)`,
        [workorderId, request.id, officeUserId, `Part request cancelled with workorder: ${reason}`, JSON.stringify({ source: "workorder_cancellation" })],
      );
    }

    const activeAttention = await client.query(
      "select reason from workorder_attention_state where workorder_id = $1 and active = true for update",
      [workorderId],
    );
    for (const attention of activeAttention.rows) {
      await setAttentionInTransaction(client, {
        workorderId,
        reason: attention.reason,
        active: false,
        actorUserId: officeUserId,
        details: { note: "Resolved because the workorder was cancelled." },
      });
    }

    await client.query(
      `update operational_workorders
       set status = $2,
           cancelled_at = now(),
           cancelled_by_user_id = $3,
           cancel_reason = $4,
           updated_at = now()
       where id = $1`,
      [workorderId, WORKORDER_STATUS.CANCELLED, officeUserId, reason],
    );
    await addStatusEvent(client, {
      workorderId,
      fromStatus: workorder.status,
      toStatus: WORKORDER_STATUS.CANCELLED,
      changedByUserId: officeUserId,
      note: `Workorder cancelled: ${reason}`,
    });
    await client.query("commit");
    return getOperationalWorkorderById(workorderId);
  } catch (error) {
    await client.query("rollback").catch(() => {});
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
      throw lifecycleConflict("WORKORDER_NOT_READY_FOR_APPROVAL", "Only workorders ready for Manager review can be approved.");
    }
    const pendingParts = await client.query(
      `select id
       from workorder_part_requests
       where workorder_id = $1
         and approval_status in ('submitted', 'needs_info')
       order by id
       for update`,
      [workorderId],
    );
    if (pendingParts.rows.length) {
      throw lifecycleConflict(
        "WORKORDER_PARTS_PENDING",
        "Review all pending part requests before approving this workorder.",
      );
    }
    await client.query(
      `
        update operational_workorders
        set status = $2,
            closed_at = now(),
            approved_by_user_id = $3,
            updated_at = now()
        where id = $1
      `,
      [workorderId, WORKORDER_STATUS.CLOSED, officeUserId]
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
      note: note || "Office approved workorder.",
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
      "select id, status from operational_workorders where id = $1 for update",
      [workorderId]
    );
    const workorder = current.rows[0];
    if (!workorder) throw new Error("Workorder not found.");
    if (![WORKORDER_STATUS.OPEN, WORKORDER_STATUS.ACCEPTED, WORKORDER_STATUS.IN_PROGRESS].includes(workorder.status)) {
      throw lifecycleConflict("WORKORDER_ASSIGNMENT_NOT_ALLOWED", "Mechanic assignments can only change on active workorders.");
    }
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
    const currentPrimaryId = active.rows.find((row) => row.assignment_role === "primary")?.mechanic_user_id || null;
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
        set status = $2,
            accepted_at = case when $3::uuid is null then accepted_at else coalesce(accepted_at, now()) end,
            updated_at = now()
        where id = $1
      `,
      [workorderId, nextStatus, nextPrimaryId]
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
