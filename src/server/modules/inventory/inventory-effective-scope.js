import { query } from '../../db/pool.js';
import { effectiveCompanyRole } from '../../auth/company-role.js';
import { InventoryError, inventoryNotFound } from './inventory.errors.js';

const RESOURCE_SCOPES = Object.freeze({
  aggregateCostLayer: 'select company_id,location_id from inventory_aggregate_cost_layers where id=$1 and company_id=any($2::uuid[]) limit 1',
  aggregateUsage: 'select company_id,location_id from workorder_aggregate_part_usages where id=$1 and company_id=any($2::uuid[]) limit 1',
  countImport: 'select company_id,location_id from inventory_count_imports where id=$1 and company_id=any($2::uuid[]) limit 1',
  countSession: 'select company_id,location_id from inventory_position_count_sessions where id=$1 and company_id=any($2::uuid[]) limit 1',
  inventoryPosition: 'select company_id,location_id from inventory_positions where id=$1 and company_id=any($2::uuid[]) limit 1',
  inventoryReceipt: 'select company_id,location_id from inventory_receipts where id=$1 and company_id=any($2::uuid[]) limit 1',
  labelBatch: 'select company_id,location_id from inventory_label_batches where id=$1 and company_id=any($2::uuid[]) limit 1',
  part: 'select company_id,null::uuid as location_id from parts_catalog where id=$1 and company_id=any($2::uuid[]) limit 1',
  serializedUnit: 'select company_id,location_id from inventory_serialized_units where id=$1 and company_id=any($2::uuid[]) limit 1',
  workorder: 'select company_id,location_id from operational_workorders where id=$1 and company_id=any($2::uuid[]) limit 1',
});

export async function resolveInventoryResourceScope(context, resourceType, resourceId, options = {}) {
  const sql = RESOURCE_SCOPES[resourceType];
  if (!sql) throw new TypeError('Unknown inventory resource scope');
  if (typeof resourceId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(resourceId)) throw inventoryNotFound();
  const lookup = options.query || query;
  const result = await lookup(sql, [resourceId, [...(context.companyIds || [])]]);
  const row = result.rows[0];
  if (!row) throw inventoryNotFound();
  const role = effectiveCompanyRole(context, row.company_id);
  const locationId = options.companyWideRoles?.includes(role) ? null : row.location_id;
  return effectiveInventoryScope(context, {
    companyId: row.company_id,
    locationId,
    ...options,
  });
}

function roleForCompany(context, companyId) {
  return effectiveCompanyRole(context, companyId);
}

export function canManageInventoryCompanyScope(context, companyIds = [...(context?.companyIds || [])]) {
  return companyIds.length > 0 && companyIds.every((companyId) => roleForCompany(context, companyId) === 'admin');
}

export function inventoryCompanyManageScope(context, options = {}) {
  const readScope = inventoryCompanyReadScope(context, {
    code: 'INVENTORY_COMPANY_WRITE_FORBIDDEN',
    message: 'Company inventory settings require Admin access.',
    ...options,
    allowedRoles: ['admin'],
  });
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
  const effectiveRole = roleForCompany(context, companyId);
  if (!['admin', 'office'].includes(effectiveRole) && !context.locationIds?.has(location.id || locationId)) throw inventoryNotFound();
  return {
    actorId: context.actor.id,
    companyId,
    locationId: location.id || locationId,
    companyIds: [companyId],
    locationIds: [location.id || locationId],
    isAdmin: false,
    companyWideRead: true,
    canManageLocation: effectiveRole === 'admin' || context.locationIds?.has(location.id || locationId) === true,
    effectiveRole,
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
