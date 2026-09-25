import { listUserActivity } from "../../db/repositories/user-activity.repo.js";

function activityItem(row, actor) {
  return {
    id: row.id,
    source: row.source,
    category: row.category,
    action: row.action,
    createdAt: row.created_at,
    actorName: actor.name,
    actorRole: actor.role,
    recordId: row.record_id,
    recordLabel: row.record_label,
    partNumber: row.part_number,
    description: row.description,
    quantityDelta: row.quantity_delta == null ? null : Number(row.quantity_delta),
    uomCode: row.uom_code,
    locationId: row.location_id,
    locationName: row.location_name,
    workorderId: row.workorder_id,
    workorderSerial: row.workorder_serial,
  };
}

export async function getUserActivity(requestContext, input, dependencies = {}) {
  const listActivity = dependencies.listActivity || listUserActivity;
  const result = await listActivity(requestContext, input);
  return { ...result, items: result.items.map((row) => activityItem(row, requestContext.actor)) };
}
