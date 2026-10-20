import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { handleInventoryApi } from './inventory.routes.js';
import { InventoryError } from './inventory.errors.js';

test('legacy bill extraction POST uses scoped route without reading a body',async()=>{
  const orderId=randomUUID(),documentId=randomUUID(),context={actor:{id:randomUUID(),role:'office'}};
  const result={document:{id:documentId},invoiceRunId:documentId,replayed:false};
  let response,called=false;
  const handled=await handleInventoryApi({method:'POST'},{},new URL(`http://localhost/api/office/inventory/purchasing/${orderId}/bills/${documentId}/extract`),{
    requestContext:context,readBody(){throw Error('Body is not required');},sendJson(_res,status,body){response={status,body};},
  },{async extractPurchaseBill(order,document,scope){called=true;assert.equal(order,orderId);assert.equal(document,documentId);assert.equal(scope,context);return result;}});
  assert.equal(handled,true);assert.equal(called,true);assert.deepEqual(response,{status:200,body:result});
});

test('legacy bill extraction route preserves scoped errors',async()=>{
  const orderId=randomUUID(),documentId=randomUUID();let response;
  await handleInventoryApi({method:'POST'},{},new URL(`http://localhost/api/office/inventory/purchasing/${orderId}/bills/${documentId}/extract`),{
    requestContext:{},sendJson(_res,status,body){response={status,body};},
  },{async extractPurchaseBill(){throw new InventoryError('Not allowed',{code:'PURCHASE_BILL_FORBIDDEN',statusCode:403});}});
  assert.equal(response.status,403);assert.equal(response.body.code,'PURCHASE_BILL_FORBIDDEN');
});
