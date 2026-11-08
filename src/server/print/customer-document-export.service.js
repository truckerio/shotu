import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { customerDocumentHtml, customerDocumentFileName } from '../../../shared/customer-document-template.js';
import { AuthError } from '../auth/errors.js';
export async function renderCustomerDocumentPdf(projection,{renderHtmlToPdf,tempDir=tmpdir()}={}) {
 if(typeof renderHtmlToPdf!=='function')throw new AuthError(503,'CUSTOMER_DOCUMENT_PDF_UNAVAILABLE','PDF generation is unavailable. Try again later.');
 const dir=await mkdtemp(join(tempDir,'customer-document-'));
 try {
  const htmlPath=join(dir,'document.html'),pdfPath=join(dir,'document.pdf');
  await writeFile(htmlPath,customerDocumentHtml(projection),{mode:0o600});
  await renderHtmlToPdf(htmlPath,pdfPath);
  const bytes=await readFile(pdfPath);
  if(bytes.subarray(0,5).toString('ascii')!=='%PDF-')throw new AuthError(503,'CUSTOMER_DOCUMENT_PDF_INVALID','PDF generation failed. Try again.');
  return {bytes,fileName:customerDocumentFileName(projection)};
 }finally{await rm(dir,{recursive:true,force:true});}
}
