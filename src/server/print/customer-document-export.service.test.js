import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,readdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderCustomerDocumentPdf } from './customer-document-export.service.js';
test('PDF writer renders escaped document in private temporary workspace and cleans all artifacts',async()=>{const root=await mkdtemp(join(tmpdir(),'export-test-'));try{const result=await renderCustomerDocumentPdf({document:{number:'EST-1',revision:2},customer:{name:'<unsafe>'}},{tempDir:root,renderHtmlToPdf:async(html,pdf)=>{assert.match(await readFile(html,'utf8'),/&lt;unsafe&gt;/);await writeFile(pdf,'%PDF-1.7\nbytes');}});assert.equal(result.fileName,'Estimate-EST-1-R2.pdf');assert.equal(result.bytes.subarray(0,5).toString(),'%PDF-');assert.deepEqual(await readdir(root),[]);await assert.rejects(renderCustomerDocumentPdf({},{tempDir:root,renderHtmlToPdf:async(_,pdf)=>writeFile(pdf,'not pdf')}),e=>e.code==='CUSTOMER_DOCUMENT_PDF_INVALID');assert.deepEqual(await readdir(root),[]);}finally{await rm(root,{recursive:true,force:true});}});
