import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";

export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;

const MIME_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

const MIME_ALIASES = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
};

function mediaRoot() {
  const storageRoot = process.env.WORKORDER_STORAGE_DIR
    ? resolve(process.env.WORKORDER_STORAGE_DIR)
    : process.cwd();
  return resolve(process.env.CHAT_MEDIA_DIR || resolve(storageRoot, "data", "chat-media"));
}

function normalizeMimeType(value) {
  const mimeType = String(value || "").trim().toLowerCase();
  return MIME_ALIASES[mimeType] || mimeType;
}

function detectedImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") {
    const brand = bytes.toString("ascii", 8, 12).toLowerCase();
    if (["heic", "heix", "hevc", "hevx", "heis", "heim", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return "";
}

function safeStoragePath(storageKey) {
  if (!/^[0-9a-f-]{36}\.(?:jpg|png|webp|heic|heif)$/.test(storageKey)) throw new Error("Invalid chat media key.");
  const root = mediaRoot();
  const filePath = resolve(root, storageKey);
  if (!filePath.startsWith(`${root}${sep}`)) throw new Error("Invalid chat media path.");
  return filePath;
}

export function sanitizeAttachmentFileName(fileName, mimeType) {
  const extension = MIME_EXTENSIONS[mimeType] || "";
  const rawBase = basename(String(fileName || "mechanic-photo"), extname(String(fileName || "")));
  const safeBase = rawBase
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 100) || "mechanic-photo";
  return `${safeBase}${extension}`;
}

export function decodeChatImageDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,([a-zA-Z0-9+/=\r\n]+)$/.exec(String(dataUrl || ""));
  if (!match) throw new Error("Attachment must be a base64 image data URL.");
  const mimeType = normalizeMimeType(match[1]);
  if (!MIME_EXTENSIONS[mimeType]) throw new Error("Only JPEG, PNG, WebP, and HEIC images are supported.");

  const encoded = match[2].replace(/\s/g, "");
  if (!encoded || encoded.length % 4 !== 0) throw new Error("Attachment contains invalid base64 data.");
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const estimatedBytes = Math.floor((encoded.length * 3) / 4) - padding;
  if (estimatedBytes > MAX_CHAT_IMAGE_BYTES) throw new Error("Attachment must be 10MB or smaller.");

  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length !== estimatedBytes) throw new Error("Attachment contains invalid base64 data.");
  const detectedMimeType = detectedImageType(bytes);
  const sameHeifFamily = detectedMimeType === "image/heic" && ["image/heic", "image/heif"].includes(mimeType);
  if (detectedMimeType !== mimeType && !sameHeifFamily) throw new Error("Attachment content does not match its image type.");
  return { bytes, mimeType };
}

export async function persistChatImageAttachment({ dataUrl, fileName }) {
  const { bytes, mimeType } = decodeChatImageDataUrl(dataUrl);
  const extension = MIME_EXTENSIONS[mimeType];
  const storageKey = `${randomUUID()}${extension}`;
  const root = mediaRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(safeStoragePath(storageKey), bytes, { flag: "wx", mode: 0o600 });
  return {
    storageKey,
    fileName: sanitizeAttachmentFileName(fileName, mimeType),
    mimeType,
    byteSize: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function removeStoredChatImage(storageKey) {
  if (!storageKey) return;
  await rm(safeStoragePath(storageKey), { force: true });
}

export async function readStoredChatImage(storageKey) {
  return readFile(safeStoragePath(storageKey));
}
