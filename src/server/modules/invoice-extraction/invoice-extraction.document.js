import crypto from "node:crypto";
import { invoiceExtractionConfig } from "./invoice-extraction.config.js";
import { InvoiceExtractionError } from "./invoice-extraction.errors.js";

const SIGNATURES = Object.freeze({
  "application/pdf": (bytes) => bytes.subarray(0, 5).toString("ascii") === "%PDF-",
  "image/png": (bytes) => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  "image/jpeg": (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/webp": (bytes) => bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP",
});
const EXTENSIONS = Object.freeze({
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
});

function invalidDocument(message, code = "invalid_invoice_document", statusCode = 400) {
  return new InvoiceExtractionError(message, { code, statusCode });
}

export function decodeInvoiceDocument({ dataUrl, mimeType }, { maxBytes = invoiceExtractionConfig.maxDocumentBytes } = {}) {
  const match = /^data:([^;,]+);base64,([a-zA-Z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!match) throw invalidDocument("Invoice must be a base64 data URL.");
  if (match[1].toLowerCase() !== mimeType) throw invalidDocument("Invoice MIME type does not match its data URL.", "invoice_mime_mismatch");
  const encoded = match[2];
  if (encoded.length % 4 !== 0 || Buffer.from(encoded, "base64").toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    throw invalidDocument("Invoice contains invalid base64 data.");
  }
  const estimatedBytes = Math.floor(encoded.length * 3 / 4);
  if (estimatedBytes > maxBytes + 2) throw invalidDocument("Invoice exceeds the 10 MiB limit.", "invoice_too_large", 413);
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length) throw invalidDocument("Invoice file is empty.");
  if (bytes.length > maxBytes) throw invalidDocument("Invoice exceeds the 10 MiB limit.", "invoice_too_large", 413);
  const signatureMatches = SIGNATURES[mimeType];
  if (!signatureMatches || !signatureMatches(bytes)) {
    throw invalidDocument("Invoice content does not match the selected file type.", "invoice_signature_mismatch");
  }
  return {
    bytes,
    byteSize: bytes.length,
    documentHash: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

export function safeInvoiceFileName(fileName) {
  const cleaned = String(fileName || "")
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  if (!cleaned) throw invalidDocument("Invoice file name is required.");
  return cleaned;
}

export function assertInvoiceFileExtension(fileName, mimeType) {
  const extension = String(fileName || "").toLowerCase().split(".").pop();
  if (!EXTENSIONS[mimeType]?.includes(extension)) {
    throw invalidDocument("Invoice file extension does not match the selected file type.", "invoice_extension_mismatch");
  }
}
