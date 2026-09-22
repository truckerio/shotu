import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql=await readFile(new URL('../../db/migrations/167_inventory_task_assignments.sql',import.meta.url),'utf8');

test('task assignment migration stores only ownership, replay and audit overlays',()=>{
 assert.match(sql,/create table inventory_task_assignments/i);
 assert.match(sql,/create table inventory_task_assignment_commands/i);
 assert.match(sql,/create table inventory_task_assignment_events/i);
 assert.match(sql,/primary key\(company_id,source_type,source_id\)/i);
 assert.match(sql,/unique|primary key\(company_id,actor_id,idempotency_key\)/i);
 assert.match(sql,/assignment actions never mutate inventory stock/i);
 assert.doesNotMatch(sql,/update inventory_items|insert into inventory_stock_movements/i);
});

test('all normalized canonical source types are constrained',()=>{
 for(const type of ['damage_inspection','receipt_exception','missing_invoice','invoice_po_decision','no_po_approval','transfer_receipt','position_recount','removed_part_custody']) assert.match(sql,new RegExp(`'${type}'`));
});
