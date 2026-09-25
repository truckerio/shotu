import { query } from "../pool.js";

const CATEGORIES = new Set(["workorders", "inventory", "parts", "inspections"]);

export function normalizeUserActivityQuery(input = {}) {
  const page = Math.max(1, Math.min(Number.parseInt(input.page, 10) || 1, 10_000));
  const pageSize = Math.max(10, Math.min(Number.parseInt(input.pageSize, 10) || 50, 100));
  const category = CATEGORIES.has(input.category) ? input.category : "";
  return { page, pageSize, category };
}

export async function listUserActivity(requestContext, input = {}, dependencies = {}) {
  const runQuery = dependencies.query || query;
  const { page, pageSize, category } = normalizeUserActivityQuery(input);
  const companyIds = [...(requestContext.companyIds || [])];
  const locationIds = [...(requestContext.locationIds || [])];
  const actorId = requestContext.actor.id;
  const allLocations = requestContext.actor.role === "admin";
  const offset = (page - 1) * pageSize;
  const result = await runQuery(
    `with activity as (
      select ('workorder-created:' || workorder.id)::text id, 'workorder_created'::text source,
        'workorders'::text category, 'created'::text action, workorder.created_at,
        workorder.company_id, workorder.location_id, workorder.id record_id, workorder.serial record_label,
        null::text part_number, workorder.concern description, null::numeric quantity_delta,
        null::text uom_code, workorder.id workorder_id, workorder.serial workorder_serial
      from operational_workorders workorder
      where workorder.created_by_user_id=$1
      union all
      select ('workorder-status:' || event.id)::text, 'workorder_status', 'workorders', event.to_status,
        event.created_at, workorder.company_id, workorder.location_id, workorder.id, workorder.serial,
        null::text, event.note, null::numeric, null::text, workorder.id, workorder.serial
      from workorder_status_events event join operational_workorders workorder on workorder.id=event.workorder_id
      where event.changed_by_user_id=$1 and event.from_status is not null
      union all
      select ('workorder-assignment:' || event.id)::text, 'workorder_assignment', 'workorders', event.action,
        event.created_at, workorder.company_id, workorder.location_id, workorder.id, workorder.serial,
        null::text, event.reason, null::numeric, null::text, workorder.id, workorder.serial
      from workorder_assignment_events event join operational_workorders workorder on workorder.id=event.workorder_id
      where event.changed_by_user_id=$1
      union all
      select ('workorder-field:' || event.id)::text, 'workorder_field', 'workorders', event.field_key,
        event.created_at, workorder.company_id, workorder.location_id, workorder.id, workorder.serial,
        null::text, event.field_label, null::numeric, null::text, workorder.id, workorder.serial
      from workorder_field_events event join operational_workorders workorder on workorder.id=event.workorder_id
      where event.changed_by_user_id=$1
      union all
      select ('workorder-attention:' || event.id)::text, 'workorder_attention', 'workorders', event.action,
        event.created_at, workorder.company_id, workorder.location_id, workorder.id, workorder.serial,
        null::text, coalesce(nullif(event.details->>'note',''),replace(event.reason,'_',' ')),
        null::numeric, null::text, workorder.id, workorder.serial
      from workorder_attention_events event join operational_workorders workorder on workorder.id=event.workorder_id
      where event.actor_user_id=$1
      union all
      select ('workorder-part:' || event.id)::text, 'workorder_part', 'workorders', event.event_type,
        event.created_at, workorder.company_id, workorder.location_id, request.id, workorder.serial,
        request.part_number, event.note, null::numeric, request.uom_code, workorder.id, workorder.serial
      from part_request_events event
      join operational_workorders workorder on workorder.id=event.workorder_id
      join workorder_part_requests request on request.id=event.part_request_id
      where event.actor_user_id=$1
      union all
      select ('inventory-movement:' || movement.id)::text, 'inventory_movement', 'inventory', movement.movement_type,
        movement.created_at, movement.company_id, movement.location_id, movement.catalog_part_id, part.part_number,
        part.part_number, movement.reason, movement.quantity_delta, movement.uom_code,
        movement.workorder_id, workorder.serial
      from inventory_stock_movements movement
      join parts_catalog part on part.company_id=movement.company_id and part.id=movement.catalog_part_id
      left join operational_workorders workorder on workorder.company_id=movement.company_id and workorder.id=movement.workorder_id
      where movement.actor_id=$1
      union all
      select ('inventory-unit:' || event.id)::text, 'inventory_unit', 'inventory', event.event_type,
        event.created_at, event.company_id, coalesce(unit.location_id, workorder.location_id), event.unit_id,
        coalesce(line.part_number,unit.serial_number), line.part_number,
        coalesce(nullif(event.details->>'reason',''),nullif(event.details->>'note','')),
        null::numeric, line.uom_code, event.workorder_id, workorder.serial
      from inventory_unit_events event
      join inventory_serialized_units unit on unit.company_id=event.company_id and unit.id=event.unit_id
      left join inventory_receipt_lines line on line.company_id=unit.company_id and line.id=unit.receipt_line_id
      left join operational_workorders workorder on workorder.company_id=event.company_id and workorder.id=event.workorder_id
      where event.actor_id=$1
      union all
      select ('part-created:' || part.id)::text, 'part_created', 'parts', 'created', part.created_at,
        part.company_id, null::uuid, part.id, part.part_number, part.part_number, part.description,
        null::numeric, part.uom_code, null::uuid, null::text
      from parts_catalog part where part.created_by=$1
      union all
      select ('part-edited:' || event.id)::text, 'part_edited', 'parts', 'updated', event.created_at,
        event.company_id, null::uuid, event.catalog_part_id,
        coalesce(event.after_state->>'partNumber',part.part_number),
        coalesce(event.after_state->>'partNumber',part.part_number),
        coalesce(event.after_state->>'description',part.description), null::numeric,
        coalesce(event.after_state->>'uomCode',part.uom_code), null::uuid, null::text
      from part_catalog_edit_events event
      join parts_catalog part on part.company_id=event.company_id and part.id=event.catalog_part_id
      where event.actor_id=$1
      union all
      select ('inspection:' || event.id)::text, 'inspection_event', 'inspections', event.event_type,
        event.created_at, event.company_id, inspection.location_id, inspection.id, inspection.inspection_number,
        null::text, coalesce(nullif(event.details->>'reason',''),nullif(event.details->>'note','')),
        null::numeric, null::text, null::uuid, null::text
      from inspection_events event
      join inspections inspection on inspection.company_id=event.company_id and inspection.id=event.inspection_id
      where event.actor_id=$1
    ), scoped as (
      select activity.*, location.name location_name
      from activity
      left join locations location on location.company_id=activity.company_id and location.id=activity.location_id
      where activity.company_id=any($2::uuid[])
        and (activity.location_id is null or $4::boolean or activity.location_id=any($3::uuid[]))
        and ($5::text='' or activity.category=$5)
    )
    select scoped.*, count(*) over()::integer total_count
    from scoped order by created_at desc,id desc limit $6 offset $7`,
    [actorId, companyIds, locationIds, allLocations, category, pageSize, offset],
  );
  const total = Number(result.rows[0]?.total_count || 0);
  return { items: result.rows.map(({ total_count: _total, ...row }) => row), page, pageSize, total, hasMore: offset + result.rows.length < total };
}
