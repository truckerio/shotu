import assert from 'node:assert/strict';
import test from 'node:test';
import { newPurchaseLine, purchaseLineEditDraft, purchaseLineEditIssues, purchaseLineEditPayload, purchaseLineEditTotal, selectPurchaseLinePart } from './purchase-order-line-edit-model.js';
const order={version:7,lines:[{id:'line-1',catalog_part_id:'part-a',part_number:'A',description:'Filter',uom_code:'ea',tracking_mode:'quantity',quantity:'2.000',unit_price:null,demand_sources:[]}]};
test('editing captures original revision and stable line identity without changing the source',()=>{
 const draft=purchaseLineEditDraft(order);draft.lines[0].quantity='3';draft.lines[0].unitPrice='12.5000';
 assert.equal(draft.version,7);assert.equal(order.lines[0].quantity,'2.000');
 assert.deepEqual(purchaseLineEditPayload(draft),[{id:'line-1',catalogPartId:'part-a',partNumber:'A',description:'Filter',uomCode:'ea',trackingMode:'quantity',quantity:3,unitPrice:'12.5000'}]);
 assert.equal(purchaseLineEditTotal(draft.lines),37.5);
});
test('unknown price stays unknown and explicit zero remains a priced line',()=>{
 const draft=purchaseLineEditDraft(order);assert.equal(purchaseLineEditPayload(draft)[0].unitPrice,null);assert.equal(purchaseLineEditTotal(draft.lines),null);
 draft.lines[0].unitPrice='0';assert.equal(purchaseLineEditPayload(draft)[0].unitPrice,'0');assert.equal(purchaseLineEditTotal(draft.lines),0);assert.deepEqual(purchaseLineEditIssues(draft),[]);
});
test('unselected search text cannot accidentally change an inventory part',()=>{
 const draft=purchaseLineEditDraft(order);draft.lines[0].query='OTHER';assert.match(purchaseLineEditIssues(draft).join(' '),/select an inventory part/);
 draft.lines[0]=selectPurchaseLinePart(draft.lines[0],{id:'part-b',partNumber:'B',description:'Seal',uomCode:'box',trackingMode:'serialized'});
 assert.equal(purchaseLineEditPayload(draft)[0].id,'line-1');assert.equal(purchaseLineEditPayload(draft)[0].catalogPartId,'part-b');assert.equal(draft.lines[0].query,'B');assert.deepEqual(purchaseLineEditIssues(draft),[]);
});
test('negative price, non-finite and zero quantities are rejected before submission',()=>{
 for(const quantity of ['0','-1','Infinity','1000000']){const draft=purchaseLineEditDraft(order);draft.lines[0].quantity=quantity;assert.match(purchaseLineEditIssues(draft).join(' '),/quantity/);}
 for(const price of ['-1','12.00001','NaN']){const draft=purchaseLineEditDraft(order);draft.lines[0].unitPrice=price;assert.match(purchaseLineEditIssues(draft).join(' '),/unit price/);}
});
test('demand-backed lines carry their protected identity and demand marker',()=>{
 const draft=purchaseLineEditDraft({...order,lines:[{...order.lines[0],demand_sources:[{sourceId:'request'}]}]});assert.equal(draft.lines[0].demandLinked,true);draft.lines[0].unitPrice='4';assert.equal(purchaseLineEditPayload(draft)[0].quantity,2);assert.equal(purchaseLineEditPayload(draft)[0].catalogPartId,'part-a');
});

test('new lines use local keys while the server owns persisted IDs',()=>{
 const draft=purchaseLineEditDraft(order);const added=newPurchaseLine('new-local-only');
 assert.equal(added.quantity,'1');assert.equal(added.unitPrice,'');assert.match(purchaseLineEditIssues({lines:[added]}).join(' '),/enter a part number/);
 draft.lines.push(selectPurchaseLinePart(added,{id:'part-b',partNumber:'B',description:'New filter',uomCode:'ea',trackingMode:'quantity'}));
 const payload=purchaseLineEditPayload(draft);assert.equal(payload[0].id,'line-1');assert.equal('id' in payload[1],false);assert.equal('isNew' in payload[1],false);assert.equal(payload[1].catalogPartId,'part-b');assert.equal(payload[1].unitPrice,null);
 assert.deepEqual(purchaseLineEditIssues(draft),[]);
});

test('adding the same part twice is rejected before changing the order',()=>{
 const draft=purchaseLineEditDraft(order);draft.lines.push(selectPurchaseLinePart(newPurchaseLine('local-2'),{id:'part-a',partNumber:'A',description:'Filter',uomCode:'ea',trackingMode:'quantity'}));
 assert.match(purchaseLineEditIssues(draft).join(' '),/already in the PO/);
});
