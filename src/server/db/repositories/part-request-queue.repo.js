import { query } from "../pool.js";
import { DEFAULT_UOM_CODE } from "../../../../shared/units-of-measure.js";

function publicQueueRow(row) {
  const supplySummary = row.supply_status.replaceAll("_", " ");
  return {
    id: row.id,
    workorderId: row.workorder_id,
    companyId: row.company_id,
    part: {
      catalogPartId: row.catalog_part_id,
      partNumber: row.part_number || "",
      description: row.description || row.raw_query || "",
      quantity: Number(row.quantity),
      uomCode: row.uom_code || DEFAULT_UOM_CODE,
    },
    workorder: {
      id: row.workorder_id,
      serial: row.workorder_serial || "",
      unitId: row.unit_id || null,
      unitLabel: row.unit_label || "",
    },
    destinationLocation: {
      locationId: row.location_id,
      locationName: row.location_name || "",
    },
    requester: {
      id: row.requested_by_user_id || null,
      name: row.requested_by_name || "",
    },
    approvalStatus: row.approval_status,
    usageStatus: row.usage_status,
    suppliedQuantity: Number(row.supplied_quantity),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    availability: {
      localQuantity: Number(row.local_available_quantity),
      networkQuantity: Number(row.network_available_quantity),
      updatedAt: row.availability_updated_at || null,
    },
    // Flat fields are the shared Office/Admin queue contract consumed by operations surfaces.
    partName: row.description || row.raw_query || row.part_number || "",
    partDescription: row.description || row.raw_query || "",
    quantity: Number(row.quantity),
    uomCode: row.uom_code || DEFAULT_UOM_CODE,
    workorderSerial: row.workorder_serial || "",
    unitNo: row.unit_label || "",
    destination: row.location_name || "",
    requesterName: row.requested_by_name || "",
    supplyStatus: row.supply_status,
    supplySummary: supplySummary.charAt(0).toUpperCase() + supplySummary.slice(1),
    status: row.queue_status,
    waitingSeconds: Number(row.waiting_seconds),
    lastActivityAt: row.updated_at,
  };
}

export function queueResultFromQueryRows(rows) {
  const result = rows[0] || {};
  return {
    items: Array.isArray(result.items) ? result.items.map(publicQueueRow) : [],
    total: Number(result.total_count) || 0,
  };
}

export async function listUnresolvedPartRequestQueue({
  companyIds, locationIds, isAdmin, page, pageSize, locationId, search, status, supply, sort,
}) {
  const offset = (page - 1) * pageSize;
  const result = await query(
    `with eligible_requests as (
       select
         pr.id, pr.workorder_id, pr.catalog_part_id, pr.part_number, pr.description, pr.raw_query,
         pr.quantity, pr.uom_code, pr.requested_by_user_id, pr.approval_status, pr.usage_status,
         pr.created_at, pr.updated_at, wo.company_id, wo.serial as workorder_serial, wo.location_id,
         coalesce(asset.unit_no, asset.name, '') as unit_label, asset.id as unit_id,
         location.name as location_name, requester.display_name as requested_by_name,
         coalesce(supply.supplied_quantity, 0) as supplied_quantity, supply.has_ordered, supply.has_received,
         coalesce(availability.local_available_quantity, 0) as local_available_quantity,
         coalesce(availability.network_available_quantity, 0) as network_available_quantity,
         availability.availability_updated_at
       from workorder_part_requests pr
       join operational_workorders wo on wo.id = pr.workorder_id
       left join assets asset on asset.id = wo.asset_id
       left join locations location on location.id = wo.location_id and location.company_id = wo.company_id
       left join user_profiles requester on requester.id = pr.requested_by_user_id
       left join lateral (
         select
           coalesce(sum(allocation.quantity) filter (where allocation.status in ('issued', 'installed')), 0) as supplied_quantity,
           coalesce(bool_or(allocation.status = 'ordered'), false) as has_ordered,
           coalesce(bool_or(allocation.status = 'received'), false) as has_received
         from part_allocations allocation
         where allocation.part_request_id = pr.id
       ) supply on true
       left join lateral (
         select
           coalesce(sum(greatest(item.quantity_on_hand - item.quantity_reserved, 0)) filter (where item.location_id = wo.location_id), 0) as local_available_quantity,
           coalesce(sum(greatest(item.quantity_on_hand - item.quantity_reserved, 0)) filter (where item.location_id is distinct from wo.location_id), 0) as network_available_quantity,
           max(item.updated_at) as availability_updated_at
         from inventory_items item
         where item.company_id = wo.company_id
           and item.source_provider = 'local'
           and item.uom_code = pr.uom_code
           and (
             (pr.catalog_part_id is not null and item.catalog_part_id = pr.catalog_part_id)
             or (pr.catalog_part_id is null and pr.normalized_part_number <> '' and item.normalized_part_number = pr.normalized_part_number)
           )
       ) availability on true
       where wo.company_id = any($1::uuid[])
         and ($3::boolean or wo.location_id = any($2::uuid[]))
         and wo.status <> 'cancelled'
         and (
           pr.approval_status in ('submitted', 'needs_info')
           or (
             pr.approval_status = 'approved'
             and coalesce(supply.supplied_quantity, 0) < pr.quantity
           )
         )
     ), filtered_requests as (
       select eligible_requests.*,
         case
           when has_ordered then 'ordered'
           when local_available_quantity + network_available_quantity >= greatest(quantity - supplied_quantity, 0) then 'available'
           when local_available_quantity + network_available_quantity > 0 then 'partial'
           else 'unavailable'
         end as supply_status,
         case
           when approval_status in ('submitted', 'needs_info') then 'requested'
           when has_received then 'received'
           when has_ordered then 'ordered'
           else 'approved'
         end as queue_status,
         extract(epoch from (now() - updated_at))::int as waiting_seconds
       from eligible_requests
       where ($6::uuid is null or location_id = $6)
         and ($7 = '' or concat_ws(' ', part_number, description, raw_query, workorder_serial, unit_label, location_name, requested_by_name) ilike '%' || $7 || '%')
         and ($8 = ''
           or ($8 = 'requested' and approval_status in ('submitted', 'needs_info'))
           or ($8 = 'approved' and approval_status = 'approved' and not has_ordered and not has_received)
           or ($8 = 'ordered' and has_ordered)
           or ($8 = 'received' and has_received))
         and ($9 = ''
           or ($9 = 'available' and not has_ordered and local_available_quantity + network_available_quantity >= greatest(quantity - supplied_quantity, 0))
           or ($9 = 'partial' and not has_ordered and local_available_quantity + network_available_quantity > 0 and local_available_quantity + network_available_quantity < greatest(quantity - supplied_quantity, 0))
           or ($9 = 'unavailable' and local_available_quantity + network_available_quantity = 0 and not has_ordered)
           or ($9 = 'ordered' and has_ordered))
     ), paged_requests as (
       select *
       from filtered_requests
       order by
         case when $10 = 'waiting:desc' then updated_at end asc,
         case when $10 = 'activity:desc' then updated_at end desc,
         case when $10 = 'activity:asc' then updated_at end asc,
         case when $10 = 'created:desc' then created_at end desc,
         id
       limit $4 offset $5
     )
     select
       (select count(*)::int from filtered_requests) as total_count,
       coalesce(jsonb_agg(
         to_jsonb(paged_requests)
         order by
           case when $10 = 'waiting:desc' then updated_at end asc,
           case when $10 = 'activity:desc' then updated_at end desc,
           case when $10 = 'activity:asc' then updated_at end asc,
           case when $10 = 'created:desc' then created_at end desc,
           id
       ), '[]'::jsonb) as items
     from paged_requests`,
    [companyIds, locationIds, isAdmin, pageSize, offset, locationId, search, status, supply, sort],
  );
  return queueResultFromQueryRows(result.rows);
}
