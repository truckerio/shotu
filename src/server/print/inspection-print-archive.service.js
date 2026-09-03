import crypto from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { AuthError } from "../auth/errors.js";
import { completeInspectionPrintArchive, failInspectionPrintArchive } from "../db/repositories/inspection-print-archives.repo.js";
import { containedStoragePath } from "./workorder-print-archive.service.js";

export function createInspectionPdfWriter({outputDir,tempDir,renderHtmlToPdf}) {
  return async (html,archive) => {
    const company=String(archive.companyId).replace(/[^a-zA-Z0-9_-]/g,"_");
    const companyDir=join(outputDir,"inspections",company);
    await mkdir(companyDir,{recursive:true});await mkdir(tempDir,{recursive:true});
    const artifactKey=`inspection-${crypto.randomUUID()}`;
    const filePath=join(companyDir,`${artifactKey}.pdf`);const htmlPath=join(tempDir,`${artifactKey}.html`);
    await writeFile(htmlPath,html);
    try { await renderHtmlToPdf(htmlPath,filePath);return filePath; }
    catch(error){await rm(filePath,{force:true}).catch(()=>{});throw error;}
    finally { await rm(htmlPath,{force:true}); }
  };
}

export function inspectionPdfSha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function integrityFailure() {
  return new AuthError(409, "INSPECTION_PRINT_ARCHIVE_INTEGRITY_FAILURE", "Inspection PDF archive is unavailable or failed integrity verification.");
}

function assertPdf(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw integrityFailure();
}

export async function materializeInspectionPdf({ archive, html }, dependencies) {
  if (archive.status === "ready") return { archive, replayed:true };
  if (archive.status !== "pending" || !archive.leaseToken) throw new AuthError(409, "INSPECTION_PRINT_ARCHIVE_NOT_READY", "Inspection PDF archive generation is already in progress.");
  let filePath;
  try {
    filePath = await dependencies.writePdf(html, archive);
    const storageKey = relative(resolve(dependencies.outputDir), resolve(filePath));
    if (!containedStoragePath(dependencies.outputDir, storageKey)) throw integrityFailure();
    const bytes = await dependencies.readFile(filePath);
    assertPdf(bytes);
    const completed = await (dependencies.completeArchive || completeInspectionPrintArchive)({
      companyId:archive.companyId,
      archiveId:archive.id,
      leaseToken:archive.leaseToken,
      pdfSha256:inspectionPdfSha256(bytes),
      pdfByteSize:bytes.byteLength,
      pdfBytes:bytes,
    });
    return { archive:completed, replayed:false };
  } catch (error) {
    await (dependencies.failArchive || failInspectionPrintArchive)({ companyId:archive.companyId,archiveId:archive.id,leaseToken:archive.leaseToken }).catch(() => {});
    throw error;
  } finally {
    if (filePath && dependencies.removeFile) await dependencies.removeFile(filePath).catch(() => {});
  }
}

export async function readInspectionArchivedPdf({ archive, html }, dependencies) {
  // A read-only user may download completion evidence before a writer has
  // materialized canonical PDF bytes. Render only the verified frozen snapshot;
  // do not claim a lease or mutate the archive through this GET path.
  if (archive.status === "pending" && html) {
    const filePath=await dependencies.writePdf(html,archive,{readOnly:true});
    try { const bytes=await dependencies.readFile(filePath);assertPdf(bytes);return{bytes,fileName:`${archive.inspectionNumber}.pdf`,snapshotMaterialization:true}; }
    finally { if(dependencies.removeFile)await dependencies.removeFile(filePath).catch(()=>{}); }
  }
  if (archive.status !== "ready") throw integrityFailure();
  if (archive.storageKey === "db:inline-pdf") {
    const bytes=archive.pdfBytes;
    assertPdf(bytes);
    if(bytes.byteLength!==archive.documentByteSize||inspectionPdfSha256(bytes)!==archive.documentSha256)throw integrityFailure();
    return {bytes,fileName:`${archive.inspectionNumber}${archive.artifactKind === "revised" ? `_R${archive.revisionNumber}` : ""}.pdf`};
  }
  if (archive.storageKey && archive.storageKey !== "inline:snapshot") {
    const filePath = containedStoragePath(dependencies.outputDir, archive.storageKey);
    if (!filePath) throw integrityFailure();
    let bytes;
    try { bytes = await dependencies.readFile(filePath); } catch { throw integrityFailure(); }
    assertPdf(bytes);
    if (bytes.byteLength !== archive.documentByteSize || inspectionPdfSha256(bytes) !== archive.documentSha256) throw integrityFailure();
    return { bytes,fileName:`${archive.inspectionNumber}${archive.artifactKind === "revised" ? `_R${archive.revisionNumber}` : ""}.pdf` };
  }

  // Pre-PDF inspection archives stored immutable printable HTML. Materialize a
  // download from that verified snapshot without rewriting legacy evidence.
  if (archive.storageKey === "inline:snapshot" && html) {
    const filePath = await dependencies.writePdf(html, archive, { legacy:true });
    try {
      const bytes = await dependencies.readFile(filePath);
      assertPdf(bytes);
      return { bytes,fileName:`${archive.inspectionNumber}${archive.artifactKind === "revised" ? `_R${archive.revisionNumber}` : ""}.pdf`,legacyMaterialization:true };
    } finally {
      if (dependencies.removeFile) await dependencies.removeFile(filePath).catch(() => {});
    }
  }
  throw integrityFailure();
}
