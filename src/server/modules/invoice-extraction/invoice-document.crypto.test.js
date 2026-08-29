import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { decryptInvoiceDocument, encryptInvoiceDocument } from "./invoice-document.crypto.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

function encryptedSource(bytes, { key, keyVersion, ivByte }) {
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const metadata = { companyId: COMPANY_ID, runId: RUN_ID, documentHash: contentSha256, mimeType: "application/pdf" };
  const encrypted = encryptInvoiceDocument(bytes, metadata, { key, keyVersion, iv: Buffer.alloc(12, ivByte) });
  return {
    company_id: COMPANY_ID,
    run_id: RUN_ID,
    content_sha256: contentSha256,
    mime_type: "application/pdf",
    byte_size: bytes.length,
    key_version: keyVersion,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    auth_tag: encrypted.authTag,
  };
}

test("decrypts current and retained historical key versions", () => {
  const currentKey = Buffer.alloc(32, 7).toString("base64");
  const historicalKey = Buffer.alloc(32, 8).toString("base64");
  const current = encryptedSource(Buffer.from("current invoice"), { key: currentKey, keyVersion: "v2", ivByte: 1 });
  const historical = encryptedSource(Buffer.from("historical invoice"), { key: historicalKey, keyVersion: "v1", ivByte: 2 });
  const options = { currentKey, currentKeyVersion: "v2", keys: JSON.stringify({ v1: historicalKey }) };

  assert.deepEqual(decryptInvoiceDocument(current, options), Buffer.from("current invoice"));
  assert.deepEqual(decryptInvoiceDocument(historical, options), Buffer.from("historical invoice"));
});

test("uses the environment historical keyring selected by stored key_version", () => {
  const previous = {
    key: process.env.INVOICE_DOCUMENT_ENCRYPTION_KEY,
    version: process.env.INVOICE_DOCUMENT_ENCRYPTION_KEY_VERSION,
    keys: process.env.INVOICE_DOCUMENT_ENCRYPTION_KEYS,
  };
  const currentKey = Buffer.alloc(32, 9).toString("base64");
  const historicalKey = Buffer.alloc(32, 10).toString("base64");
  const source = encryptedSource(Buffer.from("retained invoice"), { key: historicalKey, keyVersion: "v3", ivByte: 3 });
  process.env.INVOICE_DOCUMENT_ENCRYPTION_KEY = currentKey;
  process.env.INVOICE_DOCUMENT_ENCRYPTION_KEY_VERSION = "v4";
  process.env.INVOICE_DOCUMENT_ENCRYPTION_KEYS = JSON.stringify({ v3: historicalKey });
  try {
    assert.deepEqual(decryptInvoiceDocument(source), Buffer.from("retained invoice"));
  } finally {
    if (previous.key === undefined) delete process.env.INVOICE_DOCUMENT_ENCRYPTION_KEY;
    else process.env.INVOICE_DOCUMENT_ENCRYPTION_KEY = previous.key;
    if (previous.version === undefined) delete process.env.INVOICE_DOCUMENT_ENCRYPTION_KEY_VERSION;
    else process.env.INVOICE_DOCUMENT_ENCRYPTION_KEY_VERSION = previous.version;
    if (previous.keys === undefined) delete process.env.INVOICE_DOCUMENT_ENCRYPTION_KEYS;
    else process.env.INVOICE_DOCUMENT_ENCRYPTION_KEYS = previous.keys;
  }
});

test("unknown versions, malformed keyrings, and tampering fail closed", () => {
  const oldKey = Buffer.alloc(32, 11).toString("base64");
  const currentKey = Buffer.alloc(32, 12).toString("base64");
  const source = encryptedSource(Buffer.from("sensitive invoice"), { key: oldKey, keyVersion: "old", ivByte: 4 });

  assert.throws(
    () => decryptInvoiceDocument(source, { currentKey, currentKeyVersion: "current", keys: {} }),
    (error) => error.code === "invoice_source_key_unavailable",
  );
  assert.throws(
    () => decryptInvoiceDocument(source, { currentKey, currentKeyVersion: "current", keys: "not-json" }),
    (error) => error.code === "invoice_source_key_unavailable",
  );
  assert.throws(
    () => decryptInvoiceDocument({ ...source, auth_tag: Buffer.alloc(16) }, { currentKey, currentKeyVersion: "current", keys: { old: oldKey } }),
    (error) => error.code === "invoice_source_integrity_failed",
  );
});
