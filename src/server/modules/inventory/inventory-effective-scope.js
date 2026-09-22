import { query } from '../../db/pool.js';
import { InventoryError, inventoryNotFound } from './inventory.errors.js';

function roleForCompany(context, companyId) {
  if (context.companyRoles instanceof Map) return context.companyRoles.get(companyId) || null;
  return context.actor?.role || null;
}

export function effectiveInventoryScope(context, {
  companyId,
  locationId = null,
  allowedRoles = ['office', 'admin'],
  code = 'INVENTORY_FORBIDDEN',
  message = 'Inventory access requires Office or Admin access.',
} = {}) {
  if (!context?.actor || !companyId || !context.companyIds?.has(companyId)) throw inventoryNotFound();
  const effectiveRole = roleForCompany(context, companyId);
  if (!allowedRoles.includes(effectiveRole)) throw new InventoryError(message, { code, statusCode: 403 });
  const isAdmin = effectiveRole === 'admin';
  if (locationId && !isAdmin && !context.locationIds?.has(locationId)) throw inventoryNotFound();
  return {
    actorId: context.actor.id,
    companyId,
    locationId,
    companyIds: [companyId],
    locationIds: locationId ? [locationId] : [...(context.locationIds || [])],
    isAdmin,
    effectiveRole,
  };
}

export async function resolveInventoryLocationScope(context, locationId, options = {}) {
  const loadLocation = options.loadLocation || (async (id, companyIds) => {
    const result = await query('select id,company_id from locations where id=$1 and company_id=any($2::uuid[]) and active=true', [id, companyIds]);
    return result.rows[0] || null;
  });
  const location = await loadLocation(locationId, [...(context.companyIds || [])]);
  if (!location) throw inventoryNotFound();
  return effectiveInventoryScope(context, {
    companyId: location.company_id || location.companyId,
    locationId: location.id || locationId,
    ...options,
  });
}
