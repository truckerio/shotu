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
  integrationNotFound,
} from "../core/integration-errors.js";

function publicPreparation(row) {
  return row ? {
    id: row.id,
    workorderId: row.workorder_id,
    laborHours: Number(row.labor_hours),
    customerExternalId: row.customer_external_id || null,
    customerDisplayName: row.customer_display_name || "",
    preparedByUserId: row.prepared_by_user_id,
    preparedAt: row.prepared_at,
    updatedAt: row.updated_at,
  } : null;
}

export async function saveOdooWorkorderPreparation(companyId, workorderId, {
  laborHours,
  customerExternalId = null,
  customerDisplayName = "",
  userId,
}) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `insert into odoo_workorder_preparation (
       company_id, workorder_id, labor_hours, customer_external_id,
       customer_display_name, prepared_by_user_id, prepared_at, updated_at
     )
     select wo.company_id, wo.id, $3, $4, $5, $6, now(), now()
     from operational_workorders wo
     where wo.company_id = $1 and wo.id = $2 and wo.status = 'closed'
     on conflict (company_id, workorder_id) do update
     set labor_hours = excluded.labor_hours,
         customer_external_id = excluded.customer_external_id,
         customer_display_name = excluded.customer_display_name,
         prepared_by_user_id = excluded.prepared_by_user_id,
         prepared_at = now(),
         updated_at = now()
     returning *`,
    [tenantId, workorderId, laborHours, customerExternalId || "", customerDisplayName, userId],
  );
  if (!result.rows[0]) {
    throw integrationConflict("WORKORDER_NOT_ELIGIBLE", "Office approval is required before Odoo preparation.");
  }
  return publicPreparation(result.rows[0]);
}

export async function readOdooOutboundReadiness(companyId, workorderId) {
  const tenantId = requireCompanyId(companyId);
  const [mainResult, partResult] = await Promise.all([
    query(
      `select
         wo.id, wo.serial, wo.status, wo.work_performed, wo.updated_at,
         wo.form_data->>'mileage' as mileage,
         jsonb_typeof(coalesce(wo.form_data->'parts', '[]'::jsonb)) = 'array' as parts_valid,
         preparation.id as preparation_id,
         preparation.labor_hours,
         preparation.customer_external_id as override_customer_external_id,
         preparation.customer_display_name as override_customer_display_name,
         vehicle.external_id as vehicle_external_id,
         vehicle.display_name as vehicle_display_name,
         vehicle.mapping_status as vehicle_mapping_status,
         vehicle.active as vehicle_active,
         vehicle.customer_external_id as vehicle_customer_external_id,
         vehicle.customer_display_name as vehicle_customer_display_name,
         warehouse.external_id as warehouse_external_id,
         warehouse.display_name as warehouse_display_name,
         warehouse.active as warehouse_active,
         settings.integration_account_id,
         settings.active as settings_active,
         settings.order_model,
         settings.vehicle_field,
         settings.service_flag_field,
         settings.warehouse_field,
         settings.stable_marker_field,
         settings.service_action_external_id,
         settings.service_action_base_url,
         settings.service_action_database,
         settings.labor_product_external_id,
         settings.labor_uom_external_id,
         labor.display_name as labor_product_name,
         labor.active as labor_product_active,
         labor.uom_external_id as labor_product_uom_external_id,
         labor.uom_name as labor_product_uom_name,
         labor.uom_category_name as labor_product_uom_category_name
       from operational_workorders wo
       left join odoo_workorder_preparation preparation
         on preparation.company_id = wo.company_id and preparation.workorder_id = wo.id
       left join odoo_vehicles vehicle
         on vehicle.company_id = wo.company_id
        and vehicle.app_asset_id = wo.asset_id
        and vehicle.mapping_status = 'mapped'
       left join odoo_location_warehouse_mappings location_mapping
         on location_mapping.company_id = wo.company_id and location_mapping.location_id = wo.location_id
       left join odoo_warehouses warehouse
         on warehouse.company_id = location_mapping.company_id
        and warehouse.external_id = location_mapping.warehouse_external_id
       left join odoo_service_order_settings settings on settings.company_id = wo.company_id
       left join odoo_service_products labor
         on labor.company_id = settings.company_id
        and labor.external_id = settings.labor_product_external_id
       where wo.company_id = $1 and wo.id = $2
       limit 1`,
      [tenantId, workorderId],
    ),
    query(
      `select
         (part.ordinality - 1)::integer as line_index,
         coalesce(part.value->>'partNo', '') as part_number,
         coalesce(part.value->>'uomCode', 'pc') as uom_code,
         part.value->>'qty' as quantity,
         catalog.id as catalog_part_id,
         mapping.external_id as product_external_id,
         mapping.active as product_active,
         coalesce(
           nullif(btrim(catalog.description), ''),
           nullif(btrim(catalog.part_number), ''),
           nullif(btrim(part.value->>'partNo'), ''),
           'Part'
         ) as product_name,
         catalog.uom_code as odoo_uom_code,
         expected_uom.odoo_name as expected_odoo_uom_name,
         case
           when catalog.id is null then null
           when coalesce(part.value->>'uomCode', 'pc') = catalog.uom_code
             then case when coalesce(part.value->>'qty', '') ~ '^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$'
               then (part.value->>'qty')::numeric else null end
           when conversion.id is not null
             then case when coalesce(part.value->>'qty', '') ~ '^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$'
               then (part.value->>'qty')::numeric * conversion.conversion_factor else null end
           else null
         end as odoo_quantity
       from operational_workorders wo
       cross join lateral jsonb_array_elements(
         case when jsonb_typeof(wo.form_data->'parts') = 'array'
           then wo.form_data->'parts' else '[]'::jsonb end
       )
         with ordinality as part(value, ordinality)
       left join parts_catalog catalog
         on catalog.company_id = wo.company_id
        and (
          (coalesce(part.value->>'catalogPartId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            and catalog.id = case
              when coalesce(part.value->>'catalogPartId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              then (part.value->>'catalogPartId')::uuid else null end)
          or (
            coalesce(part.value->>'catalogPartId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            and catalog.normalized_part_number = upper(regexp_replace(coalesce(part.value->>'partNo', ''), '[^A-Za-z0-9]', '', 'g'))
          )
        )
       left join lateral (
         select case when count(*) = 1 then min(identity.external_id) end external_id,
                count(*) = 1 active
         from odoo_product_mappings identity
         where identity.company_id = catalog.company_id
           and identity.catalog_part_id = catalog.id
           and identity.active = true
       ) mapping on true
       left join part_uom_conversions conversion
         on conversion.company_id = catalog.company_id
        and conversion.catalog_part_id = catalog.id
        and conversion.from_uom_code = coalesce(part.value->>'uomCode', 'pc')
        and conversion.to_uom_code = catalog.uom_code
        and conversion.provider = 'odoo'
        and conversion.active = true
       left join units_of_measure expected_uom
         on expected_uom.code = catalog.uom_code and expected_uom.active = true
       where wo.company_id = $1 and wo.id = $2
         and (
           btrim(coalesce(part.value->>'partNo', '')) <> ''
           or btrim(coalesce(part.value->>'qty', '')) <> ''
           or btrim(coalesce(part.value->>'repairOrder', '')) <> ''
         )
       order by part.ordinality`,
      [tenantId, workorderId],
    ),
  ]);
  const row = mainResult.rows[0];
  if (!row) return { workorder: null, preparation: null, vehicle: null, warehouse: null, labor: null, parts: [] };
  const laborUomMatches = String(row.labor_product_uom_external_id || "") === String(row.labor_uom_external_id || "")
    && /^hours?$/i.test(String(row.labor_product_uom_name || "").trim())
    && /time/i.test(String(row.labor_product_uom_category_name || ""));
  return {
    workorder: {
      id: row.id,
      serial: row.serial,
      status: row.status,
      workPerformed: row.work_performed || "",
      mileage: row.mileage || "",
      updatedAt: row.updated_at,
      partsValid: row.parts_valid,
    },
    preparation: row.preparation_id ? {
      id: row.preparation_id,
      laborHours: Number(row.labor_hours),
      customerExternalId: row.override_customer_external_id || null,
      customerDisplayName: row.override_customer_display_name || "",
    } : null,
    vehicle: row.vehicle_external_id ? {
      externalId: row.vehicle_external_id,
      displayName: row.vehicle_display_name || "",
      mappingStatus: row.vehicle_mapping_status,
      active: row.vehicle_active,
      customerExternalId: row.vehicle_customer_external_id || null,
      customerDisplayName: row.vehicle_customer_display_name || "",
    } : null,
    warehouse: row.warehouse_external_id ? {
      externalId: row.warehouse_external_id,
      displayName: row.warehouse_display_name || "",
      active: row.warehouse_active,
    } : null,
    labor: row.labor_product_external_id ? {
      productExternalId: row.labor_product_external_id,
      productName: row.labor_product_name || "",
      active: row.settings_active && row.labor_product_active,
      uomCode: laborUomMatches ? "hr" : "",
      uomExternalId: row.labor_uom_external_id || null,
    } : null,
    settings: row.integration_account_id ? {
      integrationAccountId: row.integration_account_id,
      orderModel: row.order_model,
      vehicleField: row.vehicle_field,
      serviceFlagField: row.service_flag_field,
      warehouseField: row.warehouse_field,
      stableMarkerField: row.stable_marker_field,
      serviceActionExternalId: row.service_action_external_id || "",
      serviceActionBaseUrl: row.service_action_base_url || "",
      serviceActionDatabase: row.service_action_database || "",
    } : null,
    parts: partResult.rows.map((part) => ({
      lineIndex: Number(part.line_index),
      partNumber: part.part_number || "",
      uomCode: part.uom_code || "",
      catalogPartId: part.catalog_part_id || null,
      productExternalId: part.product_external_id || null,
      productActive: part.product_active,
      productName: part.product_name || "",
      odooUomCode: part.odoo_uom_code || "",
      expectedOdooUomName: part.expected_odoo_uom_name || "",
      odooQuantity: part.odoo_quantity === null ? null : Number(part.odoo_quantity),
    })),
  };
}

export async function saveOdooServiceOrderAction(companyId, {
  actionId: actionExternalId,
  baseUrl,
  database,
}) {
  const tenantId = requireCompanyId(companyId);
  const actionId = String(actionExternalId || "").trim();
  const providerBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
  const providerDatabase = String(database || "").trim();
  if (!/^[1-9][0-9]*$/.test(actionId)) {
    throw integrationConflict("ODOO_SERVICE_ACTION_INVALID", "Odoo returned an invalid service-order action.");
  }
  if (!providerBaseUrl || providerBaseUrl.length > 2000 || !providerDatabase || providerDatabase.length > 200) {
    throw integrationConflict("ODOO_SERVICE_ACTION_INVALID", "Odoo service-order navigation context is invalid.");
  }
  const result = await query(
    `update odoo_service_order_settings
     set service_action_external_id = $2,
         service_action_base_url = $3,
         service_action_database = $4,
         updated_at = now()
     where company_id = $1 and active = true
     returning service_action_external_id`,
    [tenantId, actionId, providerBaseUrl, providerDatabase],
  );
  if (!result.rows[0]) throw integrationNotFound("Odoo service-order settings");
  return result.rows[0].service_action_external_id;
}

export async function claimOdooOutboundOrder({
  companyId,
  workorderId,
  marker,
  payloadSnapshot,
  userId,
  requestId,
}) {
  const tenantId = requireCompanyId(companyId);
  const payloadHash = requestPayloadHash(payloadSnapshot || {});
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const context = await client.query(
      `select wo.status, preparation.id as preparation_id, settings.integration_account_id,
              coalesce(settings.order_model, 'sale.order') as target_model
       from operational_workorders wo
       join odoo_workorder_preparation preparation
         on preparation.company_id = wo.company_id and preparation.workorder_id = wo.id
       join odoo_service_order_settings settings
         on settings.company_id = wo.company_id and settings.active = true
       where wo.company_id = $1 and wo.id = $2
       for update of wo, preparation`,
      [tenantId, workorderId],
    );
    const source = context.rows[0];
    if (!source) throw integrationNotFound("Prepared workorder");
    if (source.status !== "closed") {
      throw integrationConflict("WORKORDER_NOT_ELIGIBLE", "Office approval is required before Odoo creation.");
    }
    const existingResult = await client.query(
      `select * from odoo_outbound_orders
       where company_id = $1 and workorder_id = $2
       for update`,
      [tenantId, workorderId],
    );
    const existing = existingResult.rows[0];
    if (existing?.state === "exported") {
      await client.query("commit");
      return {
        claimed: false,
        replayed: true,
        externalId: existing.external_id,
        serviceOrderNo: existing.external_number,
      };
    }
    if (existing?.state === "conflict") {
      await client.query("commit");
      return { claimed: false, replayed: false, conflict: true };
    }
    if (["creating", "retryable_failure"].includes(existing?.state)
      && new Date(existing.create_started_at).valueOf() > Date.now() - 5 * 60_000) {
      await client.query("commit");
      return { claimed: false, replayed: false, conflict: false };
    }
    if (existing?.state === "creating") {
      await client.query(
        `update odoo_outbound_order_attempts
         set status = 'failed', error_code = 'ODOO_ATTEMPT_LEASE_EXPIRED',
             error_message = 'The previous Odoo creation lease expired.', finished_at = now()
         where company_id = $1 and outbound_order_id = $2
           and attempt_no = $3 and status = 'started'`,
        [tenantId, existing.id, existing.attempt_count],
      );
    }
    const saved = await client.query(
      `insert into odoo_outbound_orders (
         company_id, workorder_id, preparation_id, integration_account_id,
         target_model, stable_marker, state, attempt_count, payload_hash,
         payload_snapshot, create_started_at, last_error_code,
         last_error_message, updated_at
       ) values ($1, $2, $3, $4, $5, $6, 'creating', 1, $7, $8::jsonb, now(), '', '', now())
       on conflict (company_id, workorder_id) do update
       set preparation_id = excluded.preparation_id,
           integration_account_id = excluded.integration_account_id,
           target_model = excluded.target_model,
           stable_marker = excluded.stable_marker,
           state = 'creating',
           attempt_count = odoo_outbound_orders.attempt_count + 1,
           payload_hash = excluded.payload_hash,
           payload_snapshot = excluded.payload_snapshot,
           create_started_at = now(),
           last_error_code = '',
           last_error_message = '',
           updated_at = now()
       returning id, attempt_count`,
      [
        tenantId,
        workorderId,
        source.preparation_id,
        source.integration_account_id,
        source.target_model,
        marker,
        payloadHash,
        JSON.stringify(payloadSnapshot || {}),
      ],
    );
    const outbound = saved.rows[0];
    await client.query(
      `insert into odoo_outbound_order_attempts (
         company_id, outbound_order_id, attempt_no, request_hash,
         request_snapshot, status, started_at
       ) values ($1, $2, $3, $4, $5::jsonb, 'started', now())`,
      [tenantId, outbound.id, outbound.attempt_count, payloadHash, JSON.stringify(payloadSnapshot || {})],
    );
    await appendIntegrationAudit({
      client,
      companyId: tenantId,
      provider: "odoo",
      action: "workorder.draft_create_started",
      actorType: "user",
      actorId: userId,
      targetType: "workorder",
      targetId: workorderId,
      requestId,
      details: { marker, attempt: outbound.attempt_count },
    });
    await client.query("commit");
    return { claimed: true, replayed: false, attempt: outbound.attempt_count };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function readExportedOdooOutboundOrder(companyId, workorderId) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `select external_id, external_number
     from odoo_outbound_orders
     where company_id = $1 and workorder_id = $2 and state = 'exported'
     limit 1`,
    [tenantId, workorderId],
  );
  const row = result.rows[0];
  return row ? {
    externalId: row.external_id,
    serviceOrderNo: row.external_number,
  } : null;
}

export async function updateOdooOutboundPayload(companyId, workorderId, payloadSnapshot) {
  const tenantId = requireCompanyId(companyId);
  const payloadHash = requestPayloadHash(payloadSnapshot || {});
  const result = await query(
    `with updated_order as (
       update odoo_outbound_orders
       set payload_hash = $3, payload_snapshot = $4::jsonb, updated_at = now()
       where company_id = $1 and workorder_id = $2 and state = 'creating'
       returning id, attempt_count
     )
     update odoo_outbound_order_attempts attempt
     set request_hash = $3, request_snapshot = $4::jsonb
     from updated_order outbound
     where attempt.company_id = $1
       and attempt.outbound_order_id = outbound.id
       and attempt.attempt_no = outbound.attempt_count
       and attempt.status = 'started'
     returning attempt.id`,
    [tenantId, workorderId, payloadHash, JSON.stringify(payloadSnapshot || {})],
  );
  if (!result.rows[0]) {
    throw integrationConflict("ODOO_DRAFT_STATE_CONFLICT", "Odoo draft state changed before creation.");
  }
  return true;
}

export async function recordOdooOutboundSuccess({
  companyId,
  workorderId,
  externalId,
  serviceOrderNo,
  marker,
  userId,
  requestId,
  replayed,
}) {
  const tenantId = requireCompanyId(companyId);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const workorderResult = await client.query(
      `select status from operational_workorders
       where company_id = $1 and id = $2
       for update`,
      [tenantId, workorderId],
    );
    if (workorderResult.rows[0]?.status !== "closed") {
      throw integrationConflict(
        "WORKORDER_NOT_ELIGIBLE",
        "The workorder changed before the Odoo draft could be recorded.",
      );
    }
    const result = await client.query(
      `update odoo_outbound_orders
       set state = 'exported', external_id = $3, external_number = $4,
           exported_at = now(), last_error_code = '', last_error_message = '', updated_at = now()
       where company_id = $1 and workorder_id = $2 and state = 'creating'
       returning id, attempt_count, target_model`,
      [tenantId, workorderId, externalId, serviceOrderNo],
    );
    const outbound = result.rows[0];
    if (!outbound) throw integrationConflict("ODOO_DRAFT_STATE_CONFLICT", "Odoo draft state changed during creation.");
    await client.query(
      `update odoo_outbound_order_attempts
       set status = $4, external_id = $5, external_number = $6, finished_at = now()
       where company_id = $1 and outbound_order_id = $2 and attempt_no = $3 and status = 'started'`,
      [tenantId, outbound.id, outbound.attempt_count, replayed ? "recovered" : "created", externalId, serviceOrderNo],
    );
    await client.query(
      `insert into odoo_entry_status (
         workorder_id, status, odoo_service_order_no, external_id,
         entered_by_user_id, entered_at, note, updated_at
       ) values ($1, 'entered', $2, $3, $4, now(), 'Odoo draft created by integration.', now())
       on conflict (workorder_id) do update
       set status = 'entered', odoo_service_order_no = excluded.odoo_service_order_no,
           external_id = excluded.external_id, entered_by_user_id = excluded.entered_by_user_id,
           entered_at = now(), note = excluded.note, updated_at = now()`,
      [workorderId, serviceOrderNo, externalId, userId],
    );
    const workorderUpdate = await client.query(
      `update operational_workorders set status = 'odoo_entered', updated_at = now()
       where company_id = $1 and id = $2 and status = 'closed'`,
      [tenantId, workorderId],
    );
    if (workorderUpdate.rowCount !== 1) {
      throw integrationConflict(
        "WORKORDER_NOT_ELIGIBLE",
        "The workorder changed before the Odoo draft could be recorded.",
      );
    }
    await upsertIntegrationMapping({
      client,
      companyId: tenantId,
      provider: "odoo",
      entityType: "workorder",
      internalId: workorderId,
      externalId,
      metadata: { serviceOrderNo, marker, targetModel: outbound.target_model, state: "draft" },
    });
    await appendIntegrationAudit({
      client,
      companyId: tenantId,
      provider: "odoo",
      action: replayed ? "workorder.draft_recovered" : "workorder.draft_created",
      actorType: "user",
      actorId: userId,
      targetType: "workorder",
      targetId: workorderId,
      requestId,
      details: { externalId, serviceOrderNo, marker, state: "draft" },
    });
    await appendOutboxEvent({
      client,
      companyId: tenantId,
      aggregateType: "workorder",
      aggregateId: workorderId,
      eventType: "odoo.workorder_entered",
      payload: { workorderId, externalId, serviceOrderNo, state: "draft" },
      requestId,
    });
    await client.query("commit");
    return { externalId, serviceOrderNo };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function recordOdooOutboundFailure({
  companyId,
  workorderId,
  code,
  message,
  userId,
  requestId,
}) {
  const tenantId = requireCompanyId(companyId);
  const conflict = ["ODOO_DRAFT_CONFLICT", "ODOO_CREATE_RESULT_UNKNOWN"].includes(code);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `update odoo_outbound_orders
       set state = $3, last_error_code = $4, last_error_message = $5, updated_at = now()
       where company_id = $1 and workorder_id = $2 and state = 'creating'
       returning id, attempt_count`,
      [tenantId, workorderId, conflict ? "conflict" : "retryable_failure", code, String(message || "").slice(0, 1000)],
    );
    const outbound = result.rows[0];
    if (outbound) {
      await client.query(
        `update odoo_outbound_order_attempts
         set status = $4, error_code = $5, error_message = $6, finished_at = now()
         where company_id = $1 and outbound_order_id = $2 and attempt_no = $3 and status = 'started'`,
        [tenantId, outbound.id, outbound.attempt_count, conflict ? "conflict" : "failed", code, String(message || "").slice(0, 1000)],
      );
      await appendIntegrationAudit({
        client,
        companyId: tenantId,
        provider: "odoo",
        action: conflict ? "workorder.draft_conflict" : "workorder.draft_failed",
        actorType: "user",
        actorId: userId,
        targetType: "workorder",
        targetId: workorderId,
        requestId,
        details: { code, message: String(message || "").slice(0, 1000) },
      });
    }
    await client.query("commit");
    return Boolean(outbound);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
