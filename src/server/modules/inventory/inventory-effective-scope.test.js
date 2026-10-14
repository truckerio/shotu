import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { effectiveInventoryScope, inventoryCompanyManageScope, inventoryCompanyReadScope, listInventoryBrowseLocations, resolveInventoryLocationScope, resolveInventoryReadLocationScope, resolveInventoryResourceScope } from './inventory-effective-scope.js';

test('admin A and office or mechanic B keep company-wide writes in A only', async () => {
  const a=randomUUID(),b=randomUUID(),bLocation=randomUUID();
  const base={actor:{id:randomUUID(),role:'admin'},companyIds:new Set([a,b]),locationIds:new Set([bLocation])};
  for(const bRole of ['office','mechanic']) {
    const mixed={...base,companyRoles:new Map([[a,'admin'],[b,bRole]])};
    assert.deepEqual(inventoryCompanyManageScope(mixed).companyIds,[a]);
    if(bRole==='office') assert.deepEqual(inventoryCompanyReadScope(mixed).companyIds,[a,b]);
    else assert.deepEqual(inventoryCompanyReadScope(mixed).companyIds,[a]);
    const target=()=>resolveInventoryResourceScope(mixed,'aggregateCostLayer',randomUUID(),{
      query:async()=>({rows:[{company_id:b,location_id:bLocation}]}),
    });
    if(bRole==='mechanic') await assert.rejects(target(),{code:'INVENTORY_FORBIDDEN'});
    else assert.equal((await target()).isAdmin,false);
  }
});

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

test('Office company reads include other shops while mutation scope remains location-bound', async () => {
  const companyId=randomUUID(),assignedLocationId=randomUUID(),otherLocationId=randomUUID(),actorId=randomUUID();
  const office={actor:{id:actorId,role:'office'},companyIds:new Set([companyId]),locationIds:new Set([assignedLocationId])};
  const companyRead=inventoryCompanyReadScope(office);
  assert.deepEqual(companyRead.companyIds,[companyId]);
  assert.equal(companyRead.companyWideRead,true);
  assert.throws(()=>effectiveInventoryScope(office,{companyId,locationId:otherLocationId}),{code:'inventory_not_found'});
  const locationRead=await resolveInventoryReadLocationScope(office,otherLocationId,{loadLocation:async()=>({id:otherLocationId,company_id:companyId})});
  assert.deepEqual(locationRead.locationIds,[otherLocationId]);
  assert.equal(locationRead.canManageLocation,false);
  assert.equal(locationRead.effectiveRole,'office');
  assert.throws(()=>inventoryCompanyManageScope(office),{code:'INVENTORY_COMPANY_WRITE_FORBIDDEN'});
  const adminScope=inventoryCompanyManageScope({...office,actor:{id:actorId,role:'admin'}});
  assert.deepEqual(adminScope.companyIds,[companyId]);
  assert.equal(adminScope.isAdmin,true);
});

test('browse locations mark only assigned Office shops manageable and reject non-Office roles', async () => {
  const companyId=randomUUID(),assignedLocationId=randomUUID(),otherLocationId=randomUUID(),actorId=randomUUID();
  const office={actor:{id:actorId,role:'office'},companyIds:new Set([companyId]),locationIds:new Set([assignedLocationId])};
  const result=await listInventoryBrowseLocations(office,{query:async()=>({rows:[
    {id:assignedLocationId,company_id:companyId,name:'Assigned',type:'shop',address:'A'},
    {id:otherLocationId,company_id:companyId,name:'Other',type:'shop',address:'B'},
  ]})});
  assert.deepEqual(result.locations.map((location)=>[location.name,location.canManage,location.canManageCompany]),[['Assigned',true,false],['Other',false,false]]);
  const adminResult=await listInventoryBrowseLocations({...office,actor:{id:actorId,role:'admin'}},{query:async()=>({rows:[
    {id:otherLocationId,company_id:companyId,name:'Other',type:'shop',address:'B'},
  ]})});
  assert.deepEqual(adminResult.locations.map((location)=>[location.canManage,location.canManageCompany]),[[true,true]]);
  assert.throws(()=>inventoryCompanyReadScope({...office,actor:{id:actorId,role:'mechanic'}}),{code:'INVENTORY_READ_FORBIDDEN'});
});
