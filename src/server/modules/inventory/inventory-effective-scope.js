import { query } from '../../db/pool.js';
import { InventoryError, inventoryNotFound } from './inventory.errors.js';

function roleForCompany(context, companyId) {
  if (context.companyRoles instanceof Map) return context.companyRoles.get(companyId) || null;
  return context.actor?.role || null;
}

export function canManageInventoryCompanyScope(context, companyIds = [...(context?.companyIds || [])]) {
  return companyIds.length > 0 && companyIds.every((companyId) => roleForCompany(context, companyId) === 'admin');
}

export function inventoryCompanyManageScope(context, options = {}) {
  const readScope = inventoryCompanyReadScope(context, options);
  if (!canManageInventoryCompanyScope(context, readScope.companyIds)) {
    throw new InventoryError(options.message || 'Company inventory settings require Admin access.', {
      code: options.code || 'INVENTORY_COMPANY_WRITE_FORBIDDEN',
      statusCode: 403,
    });
  }
  return { ...readScope, companyWideRead: false };
}

export function inventoryCompanyReadScope(context, {
  allowedRoles = ['office', 'admin'],
  code = 'INVENTORY_READ_FORBIDDEN',
  message = 'Inventory access requires Office or Admin access.',
} = {}) {
  if (!context?.actor) throw new InventoryError(message, { code, statusCode: 403 });
  const companyIds = [...(context.companyIds || [])]
    .filter((companyId) => allowedRoles.includes(roleForCompany(context, companyId)));
  if (!companyIds.length) throw new InventoryError(message, { code, statusCode: 403 });
  return {
    actorId: context.actor.id,
    companyIds,
    locationIds: [],
    // Repository read contracts use this flag to bypass assigned-location filtering.
    // This scope must never be passed to a mutation repository.
    isAdmin: true,
    companyWideRead: true,
  };
}

export async function resolveInventoryReadLocationScope(context, locationId, options = {}) {
  const companyScope = inventoryCompanyReadScope(context, options);
  const loadLocation = options.loadLocation || (async (id, companyIds) => {
    const result = await query('select id,company_id from locations where id=$1 and company_id=any($2::uuid[]) and active=true', [id, companyIds]);
    return result.rows[0] || null;
  });
  const location = await loadLocation(locationId, companyScope.companyIds);
  if (!location) throw inventoryNotFound();
  const companyId = location.company_id || location.companyId;
  return {
    actorId: context.actor.id,
    companyId,
    locationId: location.id || locationId,
    companyIds: [companyId],
    locationIds: [location.id || locationId],
    isAdmin: false,
    companyWideRead: true,
    canManageLocation: roleForCompany(context, companyId) === 'admin' || context.locationIds?.has(location.id || locationId) === true,
    effectiveRole: roleForCompany(context, companyId),
  };
}

export async function listInventoryBrowseLocations(context, dependencies = {}) {
  const readScope = inventoryCompanyReadScope(context);
  const queryFn = dependencies.query || query;
  const result = await queryFn(
    `select id,company_id,name,type,address
       from locations
      where active=true and company_id=any($1::uuid[])
      order by name,id`,
    [readScope.companyIds],
  );
  return {
    locations: result.rows.map((location) => ({
      id: location.id,
      companyId: location.company_id,
      name: location.name,
      type: location.type,
      address: location.address,
      canManage: roleForCompany(context, location.company_id) === 'admin' || context.locationIds?.has(location.id) === true,
      canManageCompany: roleForCompany(context, location.company_id) === 'admin',
    })),
  };
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
