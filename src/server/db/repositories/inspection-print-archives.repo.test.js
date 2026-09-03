import test from "node:test";
import assert from "node:assert/strict";
import { completeInspectionPrintArchive, createInspectionPrintArchive, ensureInspectionPrintArchiveInTransaction } from "./inspection-print-archives.repo.js";
import { inspectionPrintSnapshotDigest } from "../../modules/inspections/inspection-print-integrity.js";

const pending={id:"archive-1",company_id:"company-1",inspection_id:"inspection-1",location_id:"location-1",inspection_number:"INS-1",artifact_kind:"original",revision_number:1,status:"pending",snapshot:{html:"<html>x</html>"},snapshot_sha256:"a".repeat(64),request_sha256:"b".repeat(64),lease_token:"old-lease",lease_expires_at:"2026-01-01T00:00:00.000Z"};

test("completion snapshot inserts a pending archive without pretending HTML is PDF",async()=>{
  const snapshot={html:"<html>x</html>"};const calls=[];
  const client={query:async(sql,values)=>{calls.push({sql,values});if(sql.startsWith("select * from inspection_print_archives"))return{rows:[]};if(sql.startsWith("insert into inspection_print_archives"))return{rows:[{...pending,snapshot,snapshot_sha256:inspectionPrintSnapshotDigest(snapshot)}]};return{rows:[]};}};
  const result=await ensureInspectionPrintArchiveInTransaction({companyId:"company-1",inspectionId:"inspection-1",locationId:"location-1",inspectionNumber:"INS-1",actorId:"user-1",idempotencyKey:"inspection-complete-1",requestSha256:"b".repeat(64),snapshot,snapshotSha256:inspectionPrintSnapshotDigest(snapshot)},client);
  const insert=calls.find(({sql})=>sql.startsWith("insert into inspection_print_archives"));
  assert.doesNotMatch(insert.sql,/pdf_sha256|pdf_byte_size|inline:snapshot|'ready'/);
  assert.equal(result.archive.status,"pending");
});

test("expired pending replay gets one new generation lease",async()=>{
  const calls=[];const claimed={...pending,lease_token:"new-lease",lease_expires_at:"2026-09-03T12:02:00.000Z",attempt_number:2};
  const client={query:async(sql)=>{calls.push(sql);if(sql==="begin"||sql==="commit")return{rows:[]};if(sql.startsWith("select * from inspection_print_archives"))return{rows:[pending]};if(sql.startsWith("update inspection_print_archives"))return{rows:[claimed]};throw new Error(sql);},release(){}};
  const result=await createInspectionPrintArchive({companyId:"company-1",actorId:"user-1",idempotencyKey:"inspection-complete-1",requestSha256:"b".repeat(64)},{pool:{connect:async()=>client}});
  assert.equal(result.created,true);assert.equal(result.archive.leaseToken,"new-lease");assert.match(calls.join("\n"),/lease_expires_at=now\(\)\+interval '2 minutes'/);
});

test("finalization records immutable actual PDF bytes",async()=>{
  let values;
  const bytes=Buffer.from("%PDF-stored");
  const archive=await completeInspectionPrintArchive({companyId:"company-1",archiveId:"archive-1",leaseToken:"lease-1",pdfSha256:"c".repeat(64),pdfByteSize:bytes.byteLength,pdfBytes:bytes},{query:async(_sql,input)=>(values=input,{rows:[{...pending,status:"ready",storage_key:"db:inline-pdf",pdf_sha256:input[3],pdf_byte_size:input[4],pdf_bytes:input[5],generated_at:"now"}]})});
  assert.deepEqual(values,["company-1","archive-1","lease-1","c".repeat(64),bytes.byteLength,bytes]);
  assert.equal(archive.documentByteSize,bytes.byteLength);assert.equal("storageKey" in archive,false);assert.equal("pdfBytes" in archive,false);
});
