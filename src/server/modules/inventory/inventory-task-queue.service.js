import { query } from '../../db/pool.js';
import { listInventoryTaskQueue, mutateInventoryTaskAssignment, readInventoryTask } from '../../db/repositories/inventory-task-queue.repo.js';
import { resolveInventoryLocationScope } from './inventory-effective-scope.js';
import { InventoryError, inventoryNotFound } from './inventory.errors.js';
import { inventoryTaskAssignmentCommandSchema, inventoryTaskQueueQuerySchema, inventoryTaskSourceTypeSchema } from './inventory-task-queue.schemas.js';

const accessMessage = 'Inventory tasks require Office or Admin access.';
function roleForCompany(context, companyId) {
  return context.companyRoles instanceof Map ? context.companyRoles.get(companyId) : context.actor?.role;
}

async function listScope(context, locationId, dependencies) {
  const scopeResolver = dependencies.resolveInventoryLocationScope || resolveInventoryLocationScope;
  if (locationId) return scopeResolver(context, locationId, {
    code: 'INVENTORY_TASK_FORBIDDEN', message: accessMessage,
    loadLocation: dependencies.loadLocation,
  });
  if (!context?.actor) throw inventoryNotFound();
  const companyIds = [...(context.companyIds || [])].filter((companyId) => ['office','admin'].includes(roleForCompany(context, companyId)));
  if (!companyIds.length) throw new InventoryError(accessMessage, { code: 'INVENTORY_TASK_FORBIDDEN', statusCode: 403 });
  const queryFn = dependencies.query || query;
  const locations = await queryFn('select id,company_id from locations where active and company_id=any($1::uuid[])', [companyIds]);
  const allowed = locations.rows.filter((location) => roleForCompany(context, location.company_id) === 'admin' || context.locationIds?.has(location.id));
  return { companyIds: [...new Set(allowed.map((value) => value.company_id))], locationIds: allowed.map((value) => value.id) };
}

export async function getInventoryTaskQueue(params, context, dependencies = {}) {
  const input = inventoryTaskQueueQuerySchema.parse(Object.fromEntries(params));
  const scope = await listScope(context, input.locationId, dependencies);
  const list = dependencies.listInventoryTaskQueue || listInventoryTaskQueue;
  const companyIds=scope.companyIds || [scope.companyId];
  return list({ ...input, companyIds, locationIds: scope.locationIds, actorId: context.actor.id,
    rolesByCompany:Object.fromEntries(companyIds.map((companyId)=>[companyId,roleForCompany(context,companyId)])) });
}

export async function getInventoryTask(sourceType, sourceId, params, context, dependencies = {}) {
  sourceType = inventoryTaskSourceTypeSchema.parse(sourceType);
  sourceId = inventoryTaskAssignmentCommandSchema.options[0].shape.sourceId.parse(sourceId);
  const queryInput = inventoryTaskQueueQuerySchema.parse(Object.fromEntries(params));
  if (!queryInput.locationId) throw inventoryNotFound();
  const scope = await resolveInventoryLocationScope(context, queryInput.locationId, { code: 'INVENTORY_TASK_FORBIDDEN', message: accessMessage, loadLocation: dependencies.loadLocation });
  const read = dependencies.readInventoryTask || readInventoryTask;
  const item = await read({ companyId: scope.companyId, locationId: scope.locationId, sourceType, sourceId, actorId: scope.actorId, actorRole: scope.effectiveRole });
  if (!item) throw inventoryNotFound();
  return { item };
}

export async function postInventoryTaskAssignment(body, context, dependencies = {}) {
  const command = inventoryTaskAssignmentCommandSchema.parse(body);
  const scopeResolver = dependencies.resolveInventoryLocationScope || resolveInventoryLocationScope;
  const scope = await scopeResolver(context, command.locationId, { code: 'INVENTORY_TASK_FORBIDDEN', message: accessMessage, loadLocation: dependencies.loadLocation });
  const mutate = dependencies.mutateInventoryTaskAssignment || mutateInventoryTaskAssignment;
  return mutate({ ...command, companyId: scope.companyId, actorId: scope.actorId, actorRole: scope.effectiveRole });
}
