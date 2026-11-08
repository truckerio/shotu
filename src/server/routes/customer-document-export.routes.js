import { randomUUID } from 'node:crypto';
import { AuthError } from '../auth/errors.js';
import { readStaffCustomerDocumentRevision, previewCustomerDocument, readCustomerPortalDocument } from '../modules/customer-documents/customer-documents.service.js';
import { renderCustomerDocumentPdf } from '../print/customer-document-export.service.js';
export async function handleCustomerDocumentExportApi(req,res,url,helpers,dependencies={}) {
 const staff=req.method==='POST'&&url.pathname==='/api/customer-documents/export';
 const portal=req.method==='GET'&&url.pathname==='/api/customer-portal/export';
 const repair=req.method==='GET'&&url.pathname==='/api/customer-repair/export';
 if(!staff&&!portal&&!repair)return false;
 let projection;
 if(staff){
  const input=await helpers.readBody(req);
  if(input.revisionId){const revision=await (dependencies.readRevision||readStaffCustomerDocumentRevision)(helpers.requestContext,input.revisionId);projection=revision.snapshot;}
  else {
   const result=await(dependencies.preview||previewCustomerDocument)(helpers.requestContext,{companyId:input.companyId,locationId:input.locationId,source:input.source,documentType:input.documentType,adjustments:input.adjustments});
   if(!input.expectedContentHash||input.expectedContentHash!==result.contentHash)throw new AuthError(409,'CUSTOMER_DOCUMENT_EXPORT_STALE','The document changed. Review it again before downloading.');
   projection=result.projection;
  }
 }else if(portal){
  const result=await(dependencies.readPortal||readCustomerPortalDocument)(req.headers?.['x-customer-grant']||'',{idempotencyKey:`export:${randomUUID()}`});
  projection=result.document;
 }else{
  if(!dependencies.readRepairPortal)throw new AuthError(503,'CUSTOMER_DOCUMENT_PDF_UNAVAILABLE','PDF generation is unavailable.');
  const result=await dependencies.readRepairPortal(req.headers?.['x-customer-repair-grant']||'',{idempotencyKey:`export:${randomUUID()}`});
  const selected=Object.values(result.documents||{}).find(value=>value&&value.revisionId===url.searchParams.get('revisionId'));
  if(!selected)throw new AuthError(404,'CUSTOMER_DOCUMENT_REVISION_UNAVAILABLE','This document is unavailable.');
  projection=selected.document;
 }
 const {bytes,fileName}=await(dependencies.renderPdf||renderCustomerDocumentPdf)(projection,dependencies);
 res.writeHead(200,{'content-type':'application/pdf','content-disposition':`attachment; filename="${fileName}"`,'content-length':bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff'});
 res.end(bytes);return true;
}
