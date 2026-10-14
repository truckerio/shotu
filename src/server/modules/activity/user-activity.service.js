import { listUserActivity } from "../../db/repositories/user-activity.repo.js";
import { effectiveCompanyRole } from "../../auth/company-role.js";

function activityItem(row, actor, actorRole = actor.role) {
  return {
    id: row.id,
    source: row.source,
    category: row.category,
    action: row.action,
    createdAt: row.created_at,
    actorName: actor.name,
    actorRole,
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
  return {
    ...result,
    items: result.items.flatMap((row) => {
      const role = row.company_id
        ? effectiveCompanyRole(requestContext, row.company_id)
        : requestContext.actor.role;
      if (row.source === "workorder_field" && String(row.action || "").startsWith("pricing.")
        && !["office", "admin"].includes(role)) return [];
      return [activityItem(row, requestContext.actor, role)];
    }),
  };
}
