import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { resolveAuthConfig } from "../../auth/config.js";
import { InventoryError } from "./inventory.errors.js";

function signingKey(options = {}) {
  const explicitlyProvided = Object.hasOwn(options, "signingKey");
  const configured = explicitlyProvided ? options.signingKey : process.env.INVENTORY_QR_SIGNING_KEY;
  const raw = String(configured || "").trim();
  let key;
  if (/^[0-9a-f]{64}$/i.test(raw)) key = Buffer.from(raw, "hex");
  else key = Buffer.from(raw, "base64");
  if (!explicitlyProvided && key.length === 0) {
    try {
      const rootSecret = options.authSecret || resolveAuthConfig().secret;
      key = createHash("sha256").update(`inventory-qr-v1\0${rootSecret}`).digest();
    } catch {
      key = Buffer.alloc(0);
    }
  }
  if (key.length !== 32) {
    throw new InventoryError("Inventory QR signing is not configured.", {
      code: "inventory_qr_not_configured",
      statusCode: 503,
    });
  }
  return key;
}

function uuidBytes(uuid) {
  const hex = String(uuid || "").replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error("Inventory unit ID is invalid.");
  return Buffer.from(hex, "hex");
}

function bytesUuid(bytes) {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function assertInventoryQrConfigured(options = {}) {
  signingKey(options);
}

export function createInventoryQrToken(unitId, options = {}) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", signingKey(options), nonce);
  cipher.setAAD(Buffer.from("inventory-unit-v1"));
  const ciphertext = Buffer.concat([cipher.update(uuidBytes(unitId)), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), nonce, ciphertext, cipher.getAuthTag()]).toString("base64url");
}

export function readInventoryQrToken(token, options = {}) {
  let decoded;
  try {
    decoded = Buffer.from(String(token || ""), "base64url");
  } catch {
    decoded = Buffer.alloc(0);
  }
  if (decoded.length !== 45 || decoded[0] !== 1) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", signingKey(options), decoded.subarray(1, 13));
    decipher.setAAD(Buffer.from("inventory-unit-v1"));
    decipher.setAuthTag(decoded.subarray(29));
    const plaintext = Buffer.concat([decipher.update(decoded.subarray(13, 29)), decipher.final()]);
    return bytesUuid(plaintext);
  } catch {
    return null;
  }
}

export function inventoryScanUrl(token, origin = process.env.BETTER_AUTH_URL) {
  const base = new URL(String(origin || "http://localhost:4173"));
  base.pathname = "/";
  base.search = "";
  base.searchParams.set("inventoryScan", token);
  return base.toString();
}

export function inventoryTokenFromCode(code) {
  const value = String(code || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return parsed.searchParams.get("inventoryScan") || "";
  } catch {
    return value;
  }
}
