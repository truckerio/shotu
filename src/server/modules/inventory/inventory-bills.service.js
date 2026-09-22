import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getPool } from '../../db/pool.js';
import { InventoryError,inventoryNotFound } from './inventory.errors.js';
import { effectiveInventoryScope } from './inventory-effective-scope.js';
const id=z.string().uuid(),money=z.string().regex(/^\d{1,10}(\.\d{1,2})?$/),base={locationId:id,idempotencyKey:id};
const allocations=z.array(z.object({receiptLineId:id,quantity:z.number().positive().max(999999.999)}).strict()).min(1).max(100);
const commandSchema=z.discriminatedUnion('action',[
 z.object({...base,action:z.literal('create'),supplierId:id,reference:z.string().trim().min(1).max(240),currency:z.string().regex(/^[A-Z]{3}$/),subtotal:money,tax:money,dueDate:z.string().date(),notes:z.string().trim().max(2000).default('')}).strict(),
 z.object({...base,action:z.literal('match'),billId:id,expectedVersion:z.number().int().positive(),allocations}).strict(),
 z.object({...base,action:z.enum(['payment','credit']),billId:id,expectedVersion:z.number().int().positive(),amount:money,reference:z.string().trim().min(1).max(240)}).strict(),
]);
const fail=message=>{throw new InventoryError(message,{code:'INVENTORY_BILL_CONFLICT',statusCode:409});};
async function shop(client,locationId,context){const r=await client.query('select company_id from locations where id=$1 and company_id=any($2::uuid[]) and active=true',[locationId,[...context.companyIds]]);if(!r.rows[0])throw inventoryNotFound();return effectiveInventoryScope(context,{companyId:r.rows[0].company_id,locationId,code:'INVENTORY_BILL_FORBIDDEN',message:'Bills require Office or Admin access.'});}
async function detail(client,companyId,id){
 const r=await client.query('select b.*,s.name as supplier_name,b.subtotal+b.tax-b.paid-b.credited as outstanding from inventory_supplier_bills b join inventory_suppliers s on s.company_id=b.company_id and s.id=b.supplier_id where b.company_id=$1 and b.id=$2',[companyId,id]);
 const matched=await client.query('select a.receipt_line_id,a.quantity,l.part_number,l.uom_code from inventory_bill_receipt_allocations a join inventory_receipt_lines l on l.company_id=a.company_id and l.id=a.receipt_line_id where a.company_id=$1 and a.bill_id=$2',[companyId,id]);
 const events=await client.query('select action,amount,reference,created_at from inventory_bill_events where company_id=$1 and bill_id=$2 order by created_at desc,id desc limit 100',[companyId,id]);
 return {...r.rows[0],allocations:matched.rows,events:events.rows};
}
export async function getBills(params,context){
 const {locationId,page}=z.object({locationId:id,page:z.coerce.number().int().positive().max(100000).default(1)}).strict().parse(Object.fromEntries(params)),client=await getPool().connect();
 try{
  const authorized=await shop(client,locationId,context),companyId=authorized.companyId;
  const ids=await client.query('select id from inventory_supplier_bills where company_id=$1 and location_id=$2 order by (subtotal+tax-paid-credited>0) desc,due_date,id limit 26 offset $3',[companyId,locationId,(page-1)*25]);
  const items=[];for(const r of ids.rows.slice(0,25))items.push(await detail(client,companyId,r.id));
  const receipts=await client.query(`select l.id,l.part_number,l.uom_code,l.quantity-coalesce(a.quantity,0) as unmatched_quantity,r.posted_at,r.source_reference from local_inventory_receipt_lines l join local_inventory_receipts r on r.company_id=l.company_id and r.id=l.receipt_id left join lateral(select sum(quantity) as quantity from inventory_bill_receipt_allocations where company_id=l.company_id and receipt_line_id=l.id) a on true where l.company_id=$1 and r.location_id=$2 and r.status='posted' and l.quantity>coalesce(a.quantity,0) order by r.posted_at desc,l.id limit 100`,[companyId,locationId]);
  const outstanding=await client.query(`select currency,sum(subtotal+tax-paid-credited) as outstanding,sum(subtotal+tax-paid-credited) filter(where due_date<current_date) as overdue from inventory_supplier_bills where company_id=$1 and location_id=$2 group by currency`,[companyId,locationId]);
  return {items,receipts:receipts.rows,outstanding:outstanding.rows,page,hasMore:ids.rows.length>25,canRecordMoney:authorized.isAdmin};
 }finally{client.release();}
}
export async function postBill(body,context){
 const c=commandSchema.parse(body),client=await getPool().connect();
 try{
  await client.query('begin');const authorized=await shop(client,c.locationId,context),companyId=authorized.companyId,hash=createHash('sha256').update(JSON.stringify(c)).digest('hex');
  await client.query('select pg_advisory_xact_lock(hashtext($1))',[`purchase-command:${companyId}:${authorized.actorId}:${c.idempotencyKey}`]);
  const prior=await client.query('select request_hash,result from inventory_workflow_commands where company_id=$1 and actor_id=$2 and idempotency_key=$3',[companyId,authorized.actorId,c.idempotencyKey]);
  if(prior.rows[0]){if(prior.rows[0].request_hash!==hash)fail('This command was already used with different details.');await client.query('commit');return {...prior.rows[0].result,replayed:true};}
  let billId=c.billId;
  if(c.action==='create'){
   const supplier=await client.query('select id from inventory_suppliers where company_id=$1 and id=$2 and active=true',[companyId,c.supplierId]);if(!supplier.rows[0])throw inventoryNotFound();
   const inserted=await client.query(`insert into inventory_supplier_bills(company_id,location_id,supplier_id,reference,currency,subtotal,tax,due_date,notes,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict do nothing returning id`,[companyId,c.locationId,c.supplierId,c.reference,c.currency,c.subtotal,c.tax,c.dueDate,c.notes,authorized.actorId]);
   if(!inserted.rows[0])fail('This supplier bill reference is already recorded.');billId=inserted.rows[0].id;
  }else{
   const bill=(await client.query('select * from inventory_supplier_bills where company_id=$1 and location_id=$2 and id=$3 for update',[companyId,c.locationId,billId])).rows[0];if(!bill)throw inventoryNotFound();if(bill.version!==c.expectedVersion)fail('The bill changed. Refresh before continuing.');
   if(c.action==='match'){
    if(new Set(c.allocations.map(a=>a.receiptLineId)).size!==c.allocations.length)fail('Combine quantities for each receipt line.');
    for(const a of [...c.allocations].sort((a,b)=>a.receiptLineId.localeCompare(b.receiptLineId))){
     const receipt=(await client.query(`select l.quantity,l.uom_code,r.status from local_inventory_receipt_lines l join local_inventory_receipts r on r.company_id=l.company_id and r.id=l.receipt_id where l.company_id=$1 and r.location_id=$2 and l.id=$3 for update of l`,[companyId,c.locationId,a.receiptLineId])).rows[0];
     if(!receipt||receipt.status!=='posted')throw inventoryNotFound();
     const approvedSupplier=(await client.query('select o.supplier_id,o.currency from inventory_purchase_receipt_allocations a join inventory_purchase_lines l on l.company_id=a.company_id and l.id=a.purchase_line_id join inventory_purchase_orders o on o.company_id=l.company_id and o.id=l.order_id where a.company_id=$1 and a.receipt_line_id=$2',[companyId,a.receiptLineId])).rows[0];
     if(approvedSupplier&&(approvedSupplier.supplier_id!==bill.supplier_id||approvedSupplier.currency!==bill.currency))fail('The receipt purchase order has a different supplier or currency.');
     const allocated=await client.query('select coalesce(sum(quantity),0) as quantity from inventory_bill_receipt_allocations where company_id=$1 and receipt_line_id=$2',[companyId,a.receiptLineId]);
     if(Math.round(a.quantity*1000)/1000!==a.quantity||a.quantity>Number(receipt.quantity)-Number(allocated.rows[0].quantity))fail('The bill quantity exceeds the unmatched receipt quantity.');
     await client.query('insert into inventory_bill_receipt_allocations(company_id,bill_id,receipt_line_id,quantity) values($1,$2,$3,$4) on conflict(company_id,bill_id,receipt_line_id) do update set quantity=inventory_bill_receipt_allocations.quantity+excluded.quantity',[companyId,billId,a.receiptLineId,a.quantity]);
    }
   }else{
    if(!authorized.isAdmin)throw new InventoryError('Payment and credit evidence requires Administrator access.',{code:'INVENTORY_MONEY_FORBIDDEN',statusCode:403});
    const column=c.action==='payment'?'paid':'credited';
    const updated=await client.query(`update inventory_supplier_bills set ${column}=${column}+$3::numeric where company_id=$1 and id=$2 and $3::numeric>0 and paid+credited+$3::numeric<=subtotal+tax returning id`,[companyId,billId,c.amount]);
    if(!updated.rows[0])fail('Enter a positive amount no greater than the outstanding balance.');
   }
   await client.query('update inventory_supplier_bills set version=version+1,updated_at=now() where company_id=$1 and id=$2',[companyId,billId]);
  }
  await client.query('insert into inventory_bill_events(company_id,bill_id,actor_id,action,amount,reference,details) values($1,$2,$3,$4,$5,$6,$7)',[companyId,billId,authorized.actorId,c.action,c.amount||null,c.reference||'',JSON.stringify(c)]);
  const result={bill:await detail(client,companyId,billId)};
  await client.query('insert into inventory_workflow_commands(company_id,location_id,actor_id,idempotency_key,request_hash,result) values($1,$2,$3,$4,$5,$6)',[companyId,c.locationId,authorized.actorId,c.idempotencyKey,hash,JSON.stringify(result)]);
  await client.query('commit');return result;
 }catch(error){await client.query('rollback').catch(()=>{});throw error;}finally{client.release();}
}
