import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { postPurchaseRequest } from './inventory-purchase-requests.service.js';

test('migration 162 preserves source lineage and reconciles partial receipts and cancellations',async()=>{
  const sql=await readFile(new URL('../../db/migrations/162_inventory_purchase_line_sources.sql',import.meta.url),'utf8');
  assert.match(sql,/source_type text not null check \(source_type in \('workorder_request','stocking_policy','legacy_request'\)\)/i);
  assert.match(sql,/received_quantity \+ cancelled_quantity <= planned_quantity/i);
  assert.match(sql,/after update of received_quantity,cancelled_quantity on inventory_purchase_lines/i);
  assert.match(sql,/for update[\s\S]*source_received := least[\s\S]*source_cancelled := least/i);
  assert.doesNotMatch(sql,/delete from inventory_purchase_requests/i);
});

test('automatic demand reads approved active Workorders and locks before linked PO creation',async()=>{
  const source=await readFile(new URL('../../db/repositories/inventory-purchasing.repo.js',import.meta.url),'utf8');
  assert.match(source,/pr\.approval_status='approved'/);
  assert.match(source,/wo\.status not in \('mechanic_done','closed','odoo_entered','cancelled'\)/);
  assert.match(source,/pr\.usage_status not in \('installed','not_used','returned'\)/);
  assert.match(source,/greatest\(workorder_quantity\+legacy_quantity\+replenishment_quantity-available_quantity-incoming_quantity,0\)/);
  assert.match(source,/request\.status='approved'[\s\S]*request\.workorder_id is null/);
  assert.match(source,/pg_advisory_xact_lock[\s\S]*purchase-demand:/);
  assert.match(source,/INVENTORY_PURCHASE_DEMAND_STALE/);
  assert.match(source,/purchaseDefaults:\{currency:approvalPolicy\?\.currency\|\|'USD',approvalConfigured:Boolean\(approvalPolicy\)\}/);
});

test('standalone purchase-request writes are retired while legacy reads remain available',async()=>{
  await assert.rejects(postPurchaseRequest({
    action:'request_create',locationId:'10000000-0000-4000-8000-000000000001',idempotencyKey:'20000000-0000-4000-8000-000000000001',
    category:'part_request',catalogPartId:null,partNumber:'',description:'Legacy',uomCode:'ea',quantity:1,supplier:'',notes:'',
  },{}),error=>error.statusCode===410&&error.code==='PURCHASE_REQUESTS_READ_ONLY');
});

test('Create Workorder writes pending demand only after the durable Workorder insert',async()=>{
  const source=await readFile(new URL('../../db/repositories/operational-workorders.repo.js',import.meta.url),'utf8');
  const workorderInsert=source.indexOf('insert into operational_workorders');
  const requestInsert=source.indexOf('insert into workorder_part_requests',workorderInsert);
  assert.ok(workorderInsert>=0&&requestInsert>workorderInsert);
  assert.match(source,/pendingPurchaseRequests/);
  assert.match(source,/source:'create_workorder'/);
  assert.match(source,/part_request_events[\s\S]*'submitted'/);
});
