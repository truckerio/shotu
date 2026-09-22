import { z } from 'zod';
import { readPurchaseRequests } from '../../db/repositories/inventory-purchase-requests.repo.js';
import { resolveInventoryLocationScope } from './inventory-effective-scope.js';
import { InventoryError } from './inventory.errors.js';

const id = z.string().uuid();
const details = {
  quantity: z.number().positive().max(999999.999),
  supplier: z.string().trim().max(240).default(''),
  notes: z.string().trim().max(2000).default(''),
};
const commandScope = { locationId: id, idempotencyKey: id };
export const purchaseRequestCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...commandScope, ...details, action: z.literal('request_create'),
    category: z.enum(['suggestion','part_request']).default('part_request'),
    catalogPartId: id.nullable().default(null),
    workorderId: id.optional(),
    partNumber: z.string().trim().max(240).default(''),
    description: z.string().trim().min(1).max(500), uomCode: z.string().min(1).max(24).default('ea'),
  }).strict(),
  z.object({ ...commandScope, action: z.enum(['request_approve','request_add']), requestId: id, expectedVersion: z.number().int().positive() }).strict(),
  z.object({ ...commandScope, ...details, action: z.literal('request_update'), requestId: id, expectedVersion: z.number().int().positive() }).strict(),
]);
const scope=(context,locationId,dependencies={})=>resolveInventoryLocationScope(context,locationId,{loadLocation:dependencies.loadLocation,code:'PURCHASING_FORBIDDEN',message:'Purchasing requires Office or Admin access.'});
export async function getPurchaseRequests(searchParams, context, dependencies = {}) {
  const input = z.object({ locationId:id, page:z.coerce.number().int().min(1).max(100000).default(1),
    workorderId:id.optional(),
    status:z.enum(['needs_ordering','approval_waiting','approved','added']).default('needs_ordering'),
  }).strict().parse(Object.fromEntries(searchParams));
  const authorized = await scope(context,input.locationId,dependencies);
  return readPurchaseRequests({ ...authorized, ...input });
}
export async function postPurchaseRequest(body, context, dependencies = {}) {
  purchaseRequestCommandSchema.parse(body);
  throw new InventoryError('Standalone purchase requests are read-only. Use a Workorder part request or create a purchase order.', {
    code:'PURCHASE_REQUESTS_READ_ONLY',
    statusCode:410,
  });
}
