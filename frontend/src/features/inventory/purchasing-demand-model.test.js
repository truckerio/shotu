import assert from 'node:assert/strict';
import test from 'node:test';
import { demandPurchaseLine } from './purchasing-demand-model.js';

test('available and incoming supply cover Workorders before target-stock demand',()=>{
  const line=demandPurchaseLine({
    catalog_part_id:'10000000-0000-4000-8000-000000000001',part_number:'FILTER',description:'Filter',uom_code:'ea',
    buy_quantity:'5',workorder_quantity:'3',available_quantity:'2',incoming_quantity:'1',
    workorders:[{requestId:'20000000-0000-4000-8000-000000000001',requestedQuantity:'3'}],
  });
  assert.equal(line.quantity,5);
  assert.deepEqual(line.demandSources,[{
    sourceType:'stocking_policy',sourceId:'10000000-0000-4000-8000-000000000001',plannedQuantity:5,
  }]);
});

test('uncovered Workorder quantities retain exact request lineage before stock policy replenishment',()=>{
  const line=demandPurchaseLine({
    catalog_part_id:'10000000-0000-4000-8000-000000000001',part_number:'FILTER',description:'Filter',uom_code:'ea',
    buy_quantity:'7',workorder_quantity:'5',available_quantity:'1',incoming_quantity:'0',
    workorders:[
      {requestId:'20000000-0000-4000-8000-000000000001',requestedQuantity:'3'},
      {requestId:'20000000-0000-4000-8000-000000000002',requestedQuantity:'2'},
    ],
  });
  assert.deepEqual(line.demandSources,[
    {sourceType:'workorder_request',sourceId:'20000000-0000-4000-8000-000000000001',plannedQuantity:3},
    {sourceType:'workorder_request',sourceId:'20000000-0000-4000-8000-000000000002',plannedQuantity:1},
    {sourceType:'stocking_policy',sourceId:'10000000-0000-4000-8000-000000000001',plannedQuantity:3},
  ]);
});

test('approved legacy demand retains audit lineage during retirement',()=>{
  const line=demandPurchaseLine({
    catalog_part_id:'10000000-0000-4000-8000-000000000001',part_number:'FILTER',description:'Filter',uom_code:'ea',
    buy_quantity:'2',workorder_quantity:'0',legacy_quantity:'3',available_quantity:'1',incoming_quantity:'0',workorders:[],
    legacy_requests:[{requestId:'30000000-0000-4000-8000-000000000001',requestedQuantity:'3'}],
  });
  assert.deepEqual(line.demandSources,[{
    sourceType:'legacy_request',sourceId:'30000000-0000-4000-8000-000000000001',plannedQuantity:2,
  }]);
});
