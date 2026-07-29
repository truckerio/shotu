import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;

function decodeKey(value) {
  const configured = String(value || "").trim();
  if (!configured) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY is required before provider credentials can be stored.");
  }
  if (/^[a-f0-9]{64}$/i.test(configured)) return Buffer.from(configured, "hex");
  const source = configured.startsWith("base64:") ? configured.slice(7) : configured;
  const decoded = Buffer.from(source, "base64");
  if (decoded.length === KEY_BYTES) return decoded;
  throw new Error("INTEGRATION_ENCRYPTION_KEY must be 32 bytes encoded as base64 or 64 hexadecimal characters.");
}

function additionalAuthenticatedData(context) {
  const { companyId, provider, accountId, credentialKind = "oauth" } = context;
  if (!companyId || !provider || !accountId) {
    throw new TypeError("Credential encryption requires companyId, provider, and accountId.");
  }
  return Buffer.from(`${companyId}:${provider}:${accountId}:${credentialKind}`, "utf8");
}

export function encryptIntegrationSecret(secret, context, {
  encryptionKey = process.env.INTEGRATION_ENCRYPTION_KEY,
  keyVersion = process.env.INTEGRATION_ENCRYPTION_KEY_VERSION || "v1",
  randomBytes = crypto.randomBytes,
} = {}) {
  const key = decodeKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(additionalAuthenticatedData(context));
  const plaintext = Buffer.from(JSON.stringify(secret), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion,
  };
}

export function decryptIntegrationSecret(encrypted, context, {
  encryptionKey = process.env.INTEGRATION_ENCRYPTION_KEY,
} = {}) {
  const key = decodeKey(encryptionKey);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.iv, "base64"));
  decipher.setAAD(additionalAuthenticatedData(context));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

export function hashIntegrationToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

export function createIntegrationToken({ randomBytes = crypto.randomBytes } = {}) {
  const prefix = randomBytes(6).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  const token = `wgi_${prefix}.${secret}`;
  return { prefix, token, tokenHash: hashIntegrationToken(token) };
}

export function tokenPrefix(token) {
  const match = /^wgi_([A-Za-z0-9_-]{8})\.[A-Za-z0-9_-]{32,}$/.exec(String(token || ""));
  return match?.[1] || null;
}

export function requestPayloadHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
