import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { permissionForRequest } from "../auth/policy.js";
import { PERMISSION } from "../auth/permissions.js";
import { productionSecurityHeaders } from "./headers.js";
import {
  decodeLegacyPdfUpload,
  forcePdfFileName,
} from "./pdf-upload.js";

function dataUrl(bytes, mimeType = "application/pdf") {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

const minimalPdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstartxref\n9\n%%EOF\n", "ascii");

test("accepts a bounded PDF data URL and normalizes its MIME type", () => {
  const decoded = decodeLegacyPdfUpload(dataUrl(minimalPdf));
  assert.deepEqual(decoded.buffer, minimalPdf);
  assert.equal(decoded.mimeType, "application/pdf");
});

test("rejects malicious MIME declarations, missing PDF headers, and missing PDF trailers", () => {
  assert.throws(
    () => decodeLegacyPdfUpload(dataUrl(minimalPdf, "text/html")),
    (error) => error.statusCode === 400 && error.code === "invalid_pdf_upload",
  );
  assert.throws(
    () => decodeLegacyPdfUpload(dataUrl("<script>alert(1)</script>\nstartxref\n9\n%%EOF\n")),
    /recognized PDF header/,
  );
  assert.throws(
    () => decodeLegacyPdfUpload(dataUrl("%PDF-1.7\n<script>alert(1)</script>")),
    /recognized PDF trailer/,
  );
});

test("documents that envelope checks are not a PDF parser or malware sanitizer", () => {
  const fabricatedEnvelope = Buffer.from(
    "%PDF-1.7\n<script>alert(1)</script>\nstartxref\n9\n%%EOF\n",
    "ascii",
  );
  const decoded = decodeLegacyPdfUpload(dataUrl(fabricatedEnvelope));
  assert.deepEqual(decoded.buffer, fabricatedEnvelope);
});

test("rejects invalid base64 and decoded payloads above the configured limit", () => {
  assert.throws(() => decodeLegacyPdfUpload("data:application/pdf;base64,%%%%"), /base64 application\/pdf/);
  assert.throws(
    () => decodeLegacyPdfUpload(dataUrl(minimalPdf), { maxBytes: minimalPdf.length - 1 }),
    (error) => error.statusCode === 413 && error.code === "pdf_upload_too_large",
  );
});

test("forces sanitized PDF filenames regardless of the supplied extension", () => {
  assert.equal(forcePdfFileName("../../repair order.html"), "repair-order.pdf");
  assert.equal(forcePdfFileName("invoice.PDF"), "invoice.pdf");
  assert.equal(forcePdfFileName("", "WO-10001"), "WO-10001.pdf");
});

test("PDF bytes remain private storage and scoped API downloads are attachment-only with nosniff", async () => {
  const serverSource = await readFile(new URL("../../../server.js", import.meta.url), "utf8");
  assert.equal(permissionForRequest("GET", "/api/jobs/job-1/pdf"), PERMISSION.PRINT_MANAGE);
  assert.equal(productionSecurityHeaders()["x-content-type-options"], "nosniff");

  assert.match(serverSource, /"content-type": "application\/pdf"/);
  assert.match(serverSource, /"content-disposition": `attachment; filename="\$\{safeName\}"`/);
  assert.match(serverSource, /"cache-control": "no-store"/);
  assert.doesNotMatch(serverSource, /url\.pathname\s*===\s*["']\/uploaded-workorders/);

  const routeStart = serverSource.indexOf("const pdfMatch =");
  const routeEnd = serverSource.indexOf('if (req.method === "POST" && url.pathname === "/api/companies")', routeStart);
  const route = serverSource.slice(routeStart, routeEnd);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.match(route, /readArchivedPdf\(jobId, requestContext/);
  assert.match(route, /canReadArchiveJob\(requestContext, job\)/);
  assert.match(route, /requireWorkorderAccess\(requestContext, job\.workorderId\)/);
  assert.match(route, /sendPdfDownload\(res, job\.pdfPath/);
});
