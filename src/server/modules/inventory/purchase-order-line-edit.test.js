import assert from 'node:assert/strict';
import test from 'node:test';
import { purchaseCommandSchema } from './inventory-purchasing.schemas.js';

const ids={
  locationId:'00000000-0000-4000-8000-000000000001',
  orderId:'00000000-0000-4000-8000-000000000002',
  lineId:'00000000-0000-4000-8000-000000000003',
  key:'00000000-0000-4000-8000-000000000004',
};
const line={id:ids.lineId,partNumber:'FILTER-1',description:'Filter',uomCode:'ea',trackingMode:'quantity',quantity:2,unitPrice:'12.5000'};
const command={action:'amend_lines',locationId:ids.locationId,idempotencyKey:ids.key,orderId:ids.orderId,expectedVersion:3,lines:[line]};

test('amend_lines schema accepts id-less additions while requiring complete editable snapshots',()=>{
  assert.equal(purchaseCommandSchema.parse(command).lines[0].id,ids.lineId);
  assert.equal(purchaseCommandSchema.parse({...command,lines:[line,{...line,id:undefined,partNumber:'NEW'}]}).lines[1].id,undefined);
  assert.equal(purchaseCommandSchema.parse({...command,lines:[{...line,id:undefined,unitPrice:null}]}).lines[0].unitPrice,null);
  assert.equal(purchaseCommandSchema.safeParse({...command,lines:[{...line,id:null}]}).success,false);
  for(const field of ['partNumber','description','uomCode','trackingMode','quantity','unitPrice']) {
    const malformed=structuredClone(command);
    delete malformed.lines[0][field];
    assert.equal(purchaseCommandSchema.safeParse(malformed).success,false,field);
  }
  assert.equal(purchaseCommandSchema.safeParse({...command,lines:[line,line]}).success,false);
  assert.equal(purchaseCommandSchema.safeParse({...command,lines:[{...line,trackingMode:'no_stock'}]}).success,false);
  assert.equal(purchaseCommandSchema.safeParse({...command,lines:[{...line,unitPrice:'1.00001'}]}).success,false);
  assert.equal(purchaseCommandSchema.safeParse({...command,lines:[{...line,demandSources:[]}]}).success,false);
  assert.equal(purchaseCommandSchema.safeParse({...command,lines:Array.from({length:101},(_,index)=>({...line,id:undefined,partNumber:`NEW-${index}`}))}).success,false);
});
