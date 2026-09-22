import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { getPool } from '../../db/pool.js';
import { InventoryError, inventoryNotFound } from './inventory.errors.js';
import { decodeInvoiceDocument, safeInvoiceFileName, assertInvoiceFileExtension } from '../invoice-extraction/invoice-extraction.document.js';
import { encryptInvoiceDocument, decryptInvoiceDocument } from '../invoice-extraction/invoice-document.crypto.js';
import { effectiveInventoryScope } from './inventory-effective-scope.js';

const id=z.string().uuid();
const uploadSchema=z.object({orderId:id,idempotencyKey:id,fileName:z.string().min(1).max(240),mimeType:z.enum(['application/pdf','image/png','image/jpeg','image/webp']),dataUrl:z.string().max(14_100_000),reference:z.string().trim().max(240).default('')}).strict();
const metadata='id,file_name,mime_type,byte_size,reference,created_at';
async function orderScope(client,orderId,context,lock=false) {
  const result=await client.query(`select o.id,o.company_id,o.location_id,o.status from inventory_purchase_orders o
    join locations l on l.id=o.location_id and l.company_id=o.company_id and l.active
    where o.id=$1 and o.company_id=any($2::uuid[]) ${lock?'for update of o':''}`,
  [orderId,[...context.companyIds]]);
  if(!result.rows[0])throw inventoryNotFound();
  effectiveInventoryScope(context,{companyId:result.rows[0].company_id,locationId:result.rows[0].location_id,code:'PURCHASE_BILL_FORBIDDEN',message:'Purchase order bills require Office or Admin access.'});
  return result.rows[0];
}
function documentError(error) {
  if(error?.name==='InvoiceExtractionError') return new InventoryError(error.message,{code:error.code,statusCode:error.statusCode});
  return error;
}
export async function listPurchaseBills(orderId,context) {
  id.parse(orderId);const client=await getPool().connect();
  try {const order=await orderScope(client,orderId,context);return {items:(await client.query(`select ${metadata} from inventory_purchase_bill_documents where company_id=$1 and order_id=$2 order by created_at,id`,[order.company_id,order.id])).rows};}
  finally{client.release();}
}
export async function uploadPurchaseBill(body,context) {
  const input=uploadSchema.parse(body),client=await getPool().connect();
  try {
    await client.query('begin');
    const order=await orderScope(client,input.orderId,context,true);
    if(order.status!=='received')throw new InventoryError('Receive this purchase order before uploading its bill.',{code:'PURCHASE_BILL_NOT_RECEIVED',statusCode:409});
    const fileName=safeInvoiceFileName(input.fileName);assertInvoiceFileExtension(fileName,input.mimeType);
    const document=decodeInvoiceDocument(input,{maxBytes:10*1024*1024});
    const hash=createHash('sha256').update(JSON.stringify([order.id,document.documentHash,fileName,input.mimeType,input.reference])).digest('hex');
    await client.query('select pg_advisory_xact_lock(hashtext($1))',[`po-bill:${order.company_id}:${context.actor.id}:${input.idempotencyKey}`]);
    const prior=(await client.query(`select ${metadata},request_hash from inventory_purchase_bill_documents where company_id=$1 and uploaded_by=$2 and idempotency_key=$3`,[order.company_id,context.actor.id,input.idempotencyKey])).rows[0];
    if(prior){if(prior.request_hash!==hash)throw new InventoryError('This upload was already used with different details.',{code:'PURCHASE_BILL_REPLAY_CONFLICT',statusCode:409});delete prior.request_hash;await client.query('commit');return {document:prior,replayed:true};}
    const duplicate=(await client.query(`select ${metadata} from inventory_purchase_bill_documents where company_id=$1 and order_id=$2 and content_sha256=$3`,[order.company_id,order.id,document.documentHash])).rows[0];
    if(duplicate){await client.query('commit');return {document:duplicate,replayed:true};}
    const documentId=randomUUID();
    const source=encryptInvoiceDocument(document.bytes,{companyId:order.company_id,runId:documentId,documentHash:document.documentHash,mimeType:input.mimeType});
    const saved=await client.query(`insert into inventory_purchase_bill_documents(id,company_id,order_id,uploaded_by,idempotency_key,request_hash,file_name,mime_type,byte_size,content_sha256,reference,ciphertext,iv,auth_tag,key_version)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning ${metadata}`,
    [documentId,order.company_id,order.id,context.actor.id,input.idempotencyKey,hash,fileName,input.mimeType,document.byteSize,document.documentHash,input.reference,source.ciphertext,source.iv,source.authTag,source.keyVersion]);
    await client.query('insert into inventory_purchase_events(company_id,order_id,actor_id,action,details) values($1,$2,$3,$4,$5)',[order.company_id,order.id,context.actor.id,'bill_uploaded',JSON.stringify({documentId,fileName,reference:input.reference})]);
    await client.query('commit');return {document:saved.rows[0],replayed:false};
  }catch(error){await client.query('rollback').catch(()=>{});throw documentError(error);}finally{client.release();}
}
export async function downloadPurchaseBill(orderId,documentId,context) {
  id.parse(orderId);id.parse(documentId);const client=await getPool().connect();
  try {
    const order=await orderScope(client,orderId,context);
    const source=(await client.query('select *,id as run_id from inventory_purchase_bill_documents where company_id=$1 and order_id=$2 and id=$3',[order.company_id,order.id,documentId])).rows[0];
    if(!source)throw inventoryNotFound();
    return {bytes:decryptInvoiceDocument(source),fileName:source.file_name,mimeType:source.mime_type};
  }catch(error){throw documentError(error);}finally{client.release();}
}
