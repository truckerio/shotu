import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { getPool } from '../../db/pool.js';
import { InventoryError, inventoryNotFound } from './inventory.errors.js';
import { decodeInvoiceDocument, safeInvoiceFileName, assertInvoiceFileExtension } from '../invoice-extraction/invoice-extraction.document.js';
import { encryptInvoiceDocument, decryptInvoiceDocument } from '../invoice-extraction/invoice-document.crypto.js';
import { createInvoiceExtractionRunInTransaction, publicInvoiceExtractionRun, purchaseBillSourcePurposeSql } from '../../db/repositories/invoice-extractions.repo.js';
import { invoiceExtractionConfig } from '../invoice-extraction/invoice-extraction.config.js';
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
// Exact source identity is tenant/shop scoped; newer re-extractions supersede old runs,
// including processing or failed runs. Never infer identity from supplier or PO text.
async function latestRun(client, order, document) {
  return (await client.query(`select r.*,${purchaseBillSourcePurposeSql("r")} as is_purchase_order_bill,array_agg(id) over (order by created_at desc,id desc rows between unbounded preceding and unbounded following) as source_run_ids from invoice_extraction_runs r
    where company_id=$1 and location_id=$2 and document_hash=$3 and mime_type=$4
    order by created_at desc,id desc limit 1`,
  [order.company_id,order.location_id,document.content_sha256,document.mime_type])).rows[0] || null;
}
function withRun(document, run) {
  return Object.fromEntries([...Object.entries(document).filter(([key]) => metadata.split(',').includes(key)),
    ['invoiceRunId',run?.id || null],['extractionStatus',run?.status || null],
    ['sourceRunIds',run?.source_run_ids || (run ? [run.id] : [])]]);
}
async function prepareExtraction(client, order, document, dependencies={}) {
  await client.query('select pg_advisory_xact_lock(hashtext($1))',[
    `po-bill-extraction:${order.company_id}:${order.location_id}:${document.content_sha256}:${document.mime_type}`]);
  const existing=await latestRun(client,order,document);
  if(existing)return {run:existing,replayed:true};
  const run=await (dependencies.createInvoiceExtractionRunInTransaction || createInvoiceExtractionRunInTransaction)(client,{
    runId:document.id, companyId:order.company_id, locationId:order.location_id,
    actorId:document.uploaded_by, documentHash:document.content_sha256, fileName:document.file_name,
    mimeType:document.mime_type,byteSize:document.byte_size,idempotencyKey:`po-bill:${document.id}`,
    provider:invoiceExtractionConfig.openAiApiKey ? 'openai' : 'hybrid_local_first',
    model:invoiceExtractionConfig.model,promptVersion:invoiceExtractionConfig.promptVersion,
    source:{ciphertext:document.ciphertext,iv:document.iv,authTag:document.auth_tag,keyVersion:document.key_version},
    retentionUntil:new Date(Date.now()+invoiceExtractionConfig.documentRetentionDays*86_400_000).toISOString(),
    enqueueJob:true,maxAttempts:invoiceExtractionConfig.workerMaxAttempts,
  });
  if(!run)throw new Error('Invoice extraction could not be prepared.');
  return {run,replayed:run.inserted===false};
}
export async function listPurchaseBills(orderId,context) {
  id.parse(orderId);const client=await getPool().connect();
  try {
    const order=await orderScope(client,orderId,context);
    const documents=(await client.query(`select ${metadata},content_sha256 from inventory_purchase_bill_documents where company_id=$1 and order_id=$2 order by created_at,id`,[order.company_id,order.id])).rows;
    const items=[];
    for(const document of documents)items.push(withRun(document,await latestRun(client,order,document)));
    const allocatedSources=(await client.query(`select distinct r.id,r.document_hash as content_sha256,r.mime_type
      from inventory_purchase_invoice_allocations a
      join inventory_purchase_lines l on l.company_id=a.company_id and l.id=a.purchase_line_id
      join invoice_extraction_runs r on r.company_id=a.company_id and r.id=a.invoice_run_id
      where a.company_id=$1 and l.order_id=$2 and r.location_id=$3 and a.status<>'released'
      order by r.id`,[order.company_id,order.id,order.location_id])).rows;
    const linkedByRun=new Map();
    for(const source of allocatedSources){
      const run=await latestRun(client,order,source);
      if(run)linkedByRun.set(run.id,{invoiceRunId:run.id,fileName:run.file_name,status:run.status,sourceRunIds:run.source_run_ids});
    }
    return {items,linkedInvoices:[...linkedByRun.values()]};
  } finally{client.release();}
}
export async function extractPurchaseBill(orderId,documentId,context,dependencies={}) {
  id.parse(orderId);id.parse(documentId);const client=await getPool().connect();
  try {
    await client.query('begin');
    const order=await orderScope(client,orderId,context,true);
    if(order.status!=='received')throw new InventoryError('Receive this purchase order before uploading its bill.',{code:'PURCHASE_BILL_NOT_RECEIVED',statusCode:409});
    const document=(await client.query('select * from inventory_purchase_bill_documents where company_id=$1 and order_id=$2 and id=$3',[order.company_id,order.id,documentId])).rows[0];
    if(!document)throw inventoryNotFound();
    const {run,replayed}=await prepareExtraction(client,order,document,dependencies);
    await client.query('commit');
    return {document:withRun(document,run),run:publicInvoiceExtractionRun(run),invoiceRunId:run.id,replayed};
  }catch(error){await client.query('rollback').catch(()=>{});throw documentError(error);}finally{client.release();}
}
export async function uploadPurchaseBill(body,context,dependencies={}) {
  const input=uploadSchema.parse(body),client=await getPool().connect();
  try {
    await client.query('begin');
    const order=await orderScope(client,input.orderId,context,true);
    if(order.status!=='received')throw new InventoryError('Receive this purchase order before uploading its bill.',{code:'PURCHASE_BILL_NOT_RECEIVED',statusCode:409});
    const fileName=safeInvoiceFileName(input.fileName);assertInvoiceFileExtension(fileName,input.mimeType);
    const document=decodeInvoiceDocument(input,{maxBytes:10*1024*1024});
    const hash=createHash('sha256').update(JSON.stringify([order.id,document.documentHash,fileName,input.mimeType,input.reference])).digest('hex');
    await client.query('select pg_advisory_xact_lock(hashtext($1))',[`po-bill:${order.company_id}:${context.actor.id}:${input.idempotencyKey}`]);
    const prior=(await client.query(`select * from inventory_purchase_bill_documents where company_id=$1 and uploaded_by=$2 and idempotency_key=$3`,[order.company_id,context.actor.id,input.idempotencyKey])).rows[0];
    if(prior){if(prior.request_hash!==hash)throw new InventoryError('This upload was already used with different details.',{code:'PURCHASE_BILL_REPLAY_CONFLICT',statusCode:409});const {run}=await prepareExtraction(client,order,prior,dependencies);await client.query('commit');return {document:withRun(prior,run),replayed:true};}
    const duplicate=(await client.query(`select * from inventory_purchase_bill_documents where company_id=$1 and order_id=$2 and content_sha256=$3 and mime_type=$4`,[order.company_id,order.id,document.documentHash,input.mimeType])).rows[0];
    if(duplicate){const {run}=await prepareExtraction(client,order,duplicate,dependencies);await client.query('commit');return {document:withRun(duplicate,run),replayed:true};}
    const documentId=randomUUID();
    const source=encryptInvoiceDocument(document.bytes,{companyId:order.company_id,runId:documentId,documentHash:document.documentHash,mimeType:input.mimeType});
    const saved=await client.query(`insert into inventory_purchase_bill_documents(id,company_id,order_id,uploaded_by,idempotency_key,request_hash,file_name,mime_type,byte_size,content_sha256,reference,ciphertext,iv,auth_tag,key_version)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
    [documentId,order.company_id,order.id,context.actor.id,input.idempotencyKey,hash,fileName,input.mimeType,document.byteSize,document.documentHash,input.reference,source.ciphertext,source.iv,source.authTag,source.keyVersion]);
    await client.query('insert into inventory_purchase_events(company_id,order_id,actor_id,action,details) values($1,$2,$3,$4,$5)',[order.company_id,order.id,context.actor.id,'bill_uploaded',JSON.stringify({documentId,fileName,reference:input.reference})]);
    const {run}=await prepareExtraction(client,order,saved.rows[0],dependencies);
    await client.query('commit');return {document:withRun(saved.rows[0],run),replayed:false};
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
