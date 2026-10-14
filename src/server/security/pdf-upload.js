import { extname } from "node:path";
import { SecurityHttpError } from "./errors.js";

export const MAX_LEGACY_PDF_UPLOAD_BYTES = 50 * 1024 * 1024;

function invalidPdf(message, statusCode = 400) {
  throw new SecurityHttpError(message, {
    code: statusCode === 413 ? "pdf_upload_too_large" : "invalid_pdf_upload",
    statusCode,
  });
}

function decodedByteLength(base64) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

// This is deliberately envelope validation, not a PDF parser or malware sanitizer.
// It rejects obvious non-PDF uploads and truncation. Safe delivery still depends on
// private storage plus scoped, attachment-only responses with MIME sniffing disabled.
function assertPdfEnvelope(buffer) {
  const header = buffer.subarray(0, 8).toString("ascii");
  if (!/^%PDF-(?:1\.[0-9]|2\.0)/.test(header)) {
    invalidPdf("Uploaded workorder must contain a recognized PDF header.");
  }
  const tail = buffer.subarray(Math.max(0, buffer.length - 2048)).toString("latin1");
  if (!/startxref\s+\d+\s+%%EOF\s*$/.test(tail)) {
    invalidPdf("Uploaded workorder must contain a recognized PDF trailer.");
  }
}

export function decodeLegacyPdfUpload(dataUrl, {
  maxBytes = MAX_LEGACY_PDF_UPLOAD_BYTES,
} = {}) {
  const match = /^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl || ""));
  if (!match || match[1].length % 4 !== 0) {
    invalidPdf("Uploaded workorder must be a base64 application/pdf data URL.");
  }

  const estimatedBytes = decodedByteLength(match[1]);
  if (estimatedBytes <= 0) invalidPdf("Uploaded workorder PDF is empty.");
  if (estimatedBytes > maxBytes) invalidPdf(`Uploaded workorder PDF exceeds the ${maxBytes} byte limit.`, 413);

  const buffer = Buffer.from(match[1], "base64");
  if (buffer.length !== estimatedBytes) invalidPdf("Uploaded workorder contains invalid base64 data.");
  assertPdfEnvelope(buffer);
  return { buffer, mimeType: "application/pdf" };
}

export function forcePdfFileName(fileName, fallback = "workorder") {
  const input = String(fileName || fallback).trim();
  const withoutExtension = extname(input) ? input.slice(0, -extname(input).length) : input;
  const safeBase = withoutExtension
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 116) || "workorder";
  return `${safeBase}.pdf`;
}
