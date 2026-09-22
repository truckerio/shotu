import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { effectiveInventoryScope, resolveInventoryLocationScope } from './inventory-effective-scope.js';

test('target-company role controls inventory authority instead of the primary role', async () => {
  const companyId=randomUUID(),locationId=randomUUID(),actorId=randomUUID();
  const mixed={actor:{id:actorId,role:'admin'},companyIds:new Set([companyId]),locationIds:new Set([locationId]),companyRoles:new Map([[companyId,'mechanic']])};
  assert.throws(()=>effectiveInventoryScope(mixed,{companyId,locationId}),{code:'INVENTORY_FORBIDDEN'});
  await assert.rejects(resolveInventoryLocationScope(mixed,locationId,{loadLocation:async()=>({id:locationId,company_id:companyId})}),{code:'INVENTORY_FORBIDDEN'});
});

test('target-company office stays location-bound while target-company admin may cross locations', () => {
  const companyId=randomUUID(),locationId=randomUUID(),actorId=randomUUID();
  const base={actor:{id:actorId,role:'admin'},companyIds:new Set([companyId]),locationIds:new Set(),companyRoles:new Map([[companyId,'office']])};
  assert.throws(()=>effectiveInventoryScope(base,{companyId,locationId}));
  const admin=effectiveInventoryScope({...base,actor:{id:actorId,role:'office'},companyRoles:new Map([[companyId,'admin']])},{companyId,locationId});
  assert.equal(admin.effectiveRole,'admin');
  assert.equal(admin.isAdmin,true);
  assert.deepEqual(admin.companyIds,[companyId]);
});
