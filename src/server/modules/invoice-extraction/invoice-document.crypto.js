import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { invoiceExtractionConfig } from "./invoice-extraction.config.js";
import { InvoiceExtractionError } from "./invoice-extraction.errors.js";

function developmentKey() {
  if (process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) return "";
  const directory = resolve(process.env.WORKORDER_STORAGE_DIR || process.cwd(), ".local-secrets");
  const filePath = join(directory, "invoice-document.key");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    return readFileSync(filePath, "utf8").trim();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const generated = randomBytes(32).toString("base64");
  try {
    writeFileSync(filePath, `${generated}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return generated;
  } catch (error) {
    if (error?.code === "EEXIST") return readFileSync(filePath, "utf8").trim();
    throw error;
  }
}

function keyBytes(value = invoiceExtractionConfig.documentEncryptionKey || developmentKey()) {
  const raw = String(value || "").trim();
  let key;
  if (/^[0-9a-f]{64}$/i.test(raw)) key = Buffer.from(raw, "hex");
  else {
    try {
      key = Buffer.from(raw, "base64");
    } catch {
      key = Buffer.alloc(0);
    }
  }
  if (key.length !== 32) {
    throw new InvoiceExtractionError("Secure invoice storage is not configured.", {
      code: "invoice_storage_not_configured",
      statusCode: 503,
    });
  }
  return key;
}

export function invoiceDocumentAad({ companyId, runId, documentHash, mimeType }) {
  return Buffer.from(JSON.stringify({
    purpose: "invoice-source-v1",
    companyId,
    runId,
    documentHash,
    mimeType,
  }), "utf8");
}

export function encryptInvoiceDocument(bytes, metadata, options = {}) {
  const key = keyBytes(options.key);
  const iv = options.iv || randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(invoiceDocumentAad(metadata));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return {
    ciphertext,
    iv: Buffer.from(iv),
    authTag: cipher.getAuthTag(),
    keyVersion: String(options.keyVersion || invoiceExtractionConfig.documentEncryptionKeyVersion),
  };
}

export function decryptInvoiceDocument(source, options = {}) {
  try {
    const key = keyBytes(options.key);
    const decipher = createDecipheriv("aes-256-gcm", key, source.iv);
    decipher.setAAD(invoiceDocumentAad({
      companyId: source.company_id,
      runId: source.run_id,
      documentHash: source.content_sha256,
      mimeType: source.mime_type,
    }));
    decipher.setAuthTag(source.auth_tag);
    const plaintext = Buffer.concat([decipher.update(source.ciphertext), decipher.final()]);
    const hash = createHash("sha256").update(plaintext).digest("hex");
    if (plaintext.length !== Number(source.byte_size) || hash !== source.content_sha256) throw new Error("integrity mismatch");
    return plaintext;
  } catch (error) {
    if (error instanceof InvoiceExtractionError) throw error;
    throw new InvoiceExtractionError("The encrypted invoice source is unavailable.", {
      code: "invoice_source_integrity_failed",
      statusCode: 500,
    });
  }
}
