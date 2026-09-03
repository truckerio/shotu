import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInspectionPdfWriter, inspectionPdfSha256, materializeInspectionPdf, readInspectionArchivedPdf } from "./inspection-print-archive.service.js";

const ROOT="/tmp/inspection-print-tests";
const pdf=Buffer.from("%PDF-1.7\ninspection");
const pending={id:"archive-1",companyId:"company-1",inspectionNumber:"INS-1",artifactKind:"original",revisionNumber:1,status:"pending",leaseToken:"lease-1"};

test("materialization stores actual PDF byte evidence",async()=>{
  let completed; let removed;
  const result=await materializeInspectionPdf({archive:pending,html:"<html>inspection</html>"},{
    outputDir:ROOT,writePdf:async()=>`${ROOT}/company/archive.pdf`,readFile:async()=>pdf,
    completeArchive:async(input)=>(completed=input,{...pending,status:"ready",documentSha256:input.pdfSha256,documentByteSize:input.pdfByteSize}),
    failArchive:async()=>assert.fail("must not fail"),removeFile:async(path)=>{removed=path;},
  });
  assert.equal(completed.pdfSha256,inspectionPdfSha256(pdf));
  assert.equal(completed.pdfByteSize,pdf.byteLength);
  assert.deepEqual(completed.pdfBytes,pdf);
  assert.equal(result.archive.status,"ready");
  assert.equal(removed,`${ROOT}/company/archive.pdf`);
});

test("materialization rejects non-PDF output and marks attempt failed",async()=>{
  let failed=false;
  await assert.rejects(materializeInspectionPdf({archive:pending,html:"<html>x</html>"},{outputDir:ROOT,writePdf:async()=>`${ROOT}/bad.pdf`,readFile:async()=>Buffer.from("html"),completeArchive:async()=>assert.fail(),failArchive:async()=>{failed=true;}}),error=>error.code==="INSPECTION_PRINT_ARCHIVE_INTEGRITY_FAILURE");
  assert.equal(failed,true);
});

test("ready PDF download verifies contained path, byte count, and digest",async()=>{
  const archive={...pending,status:"ready",storageKey:"company/archive.pdf",documentSha256:inspectionPdfSha256(pdf),documentByteSize:pdf.byteLength};
  const result=await readInspectionArchivedPdf({archive},{outputDir:ROOT,readFile:async()=>pdf});
  assert.equal(result.fileName,"INS-1.pdf");
  assert.deepEqual(result.bytes,pdf);
  await assert.rejects(readInspectionArchivedPdf({archive:{...archive,documentSha256:"0".repeat(64)}},{outputDir:ROOT,readFile:async()=>pdf}),error=>error.code==="INSPECTION_PRINT_ARCHIVE_INTEGRITY_FAILURE");
});

test("database-backed PDF download verifies immutable bytes",async()=>{
  const archive={...pending,status:"ready",storageKey:"db:inline-pdf",pdfBytes:pdf,documentSha256:inspectionPdfSha256(pdf),documentByteSize:pdf.byteLength};
  const result=await readInspectionArchivedPdf({archive},{outputDir:ROOT,readFile:async()=>assert.fail()});
  assert.deepEqual(result.bytes,pdf);
});

test("verified legacy HTML can materialize a PDF without rewriting archive evidence",async()=>{
  const archive={...pending,status:"ready",storageKey:"inline:snapshot",documentSha256:"legacy-html-digest",documentByteSize:21};
  let removed;
  const result=await readInspectionArchivedPdf({archive,html:"<html>legacy</html>"},{outputDir:ROOT,writePdf:async()=>`${ROOT}/legacy.pdf`,readFile:async()=>pdf,removeFile:async(path)=>{removed=path;}});
  assert.equal(result.legacyMaterialization,true);
  assert.deepEqual(result.bytes,pdf);
  assert.equal(removed,`${ROOT}/legacy.pdf`);
});

test("read-only download renders a pending frozen snapshot without claiming or changing archive evidence",async()=>{
  let rendered;let removed;
  const result=await readInspectionArchivedPdf({archive:pending,html:"<html>frozen completion</html>"},{outputDir:ROOT,writePdf:async(html,_archive,options)=>(rendered={html,options},`${ROOT}/read.pdf`),readFile:async()=>pdf,removeFile:async(path)=>{removed=path;},completeArchive:async()=>assert.fail("GET must not mutate"),failArchive:async()=>assert.fail("GET must not mutate")});
  assert.equal(rendered.html,"<html>frozen completion</html>");assert.deepEqual(rendered.options,{readOnly:true});assert.equal(result.snapshotMaterialization,true);assert.deepEqual(result.bytes,pdf);assert.equal(removed,`${ROOT}/read.pdf`);
});

test("concurrent read/read and read/materialize renders own distinct temporary files",async()=>{
  const root=await mkdtemp(join(tmpdir(),"inspection-concurrent-pdf-"));const paths=[];
  try{
    const writer=createInspectionPdfWriter({outputDir:root,tempDir:join(root,"tmp"),renderHtmlToPdf:async(htmlPath,pdfPath)=>{paths.push([htmlPath,pdfPath]);const html=await readFile(htmlPath,"utf8");await writeFile(pdfPath,Buffer.from(`%PDF-1.7\n${html}`));}});
    const dependencies={outputDir:root,writePdf:writer,readFile,removeFile:(path)=>rm(path,{force:true}),completeArchive:async()=>({...pending,status:"ready"}),failArchive:async()=>assert.fail("concurrent render must not fail")};
    const results=await Promise.all([readInspectionArchivedPdf({archive:pending,html:"frozen-a"},dependencies),readInspectionArchivedPdf({archive:pending,html:"frozen-b"},dependencies),materializeInspectionPdf({archive:pending,html:"frozen-c"},dependencies)]);
    assert.equal(new Set(paths.map(([html])=>html)).size,3);assert.equal(new Set(paths.map(([,pdfPath])=>pdfPath)).size,3);
    assert.match(results[0].bytes.toString(),/frozen-a/);assert.match(results[1].bytes.toString(),/frozen-b/);assert.equal(results[2].archive.status,"ready");
    assert.deepEqual(await readdir(join(root,"tmp")),[]);assert.deepEqual(await readdir(join(root,"inspections",pending.companyId)),[]);
  }finally{await rm(root,{recursive:true,force:true});}
});
