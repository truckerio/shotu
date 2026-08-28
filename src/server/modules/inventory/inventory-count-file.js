import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { normalizePartNumber } from "../parts/part.constants.js";
import { InventoryError } from "./inventory.errors.js";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const EXPECTED_HEADERS = ["Part #", "Part Name", "Category", "Fits / Description", "Bin / Shelf", "Opening Qty"];
const MAX_UNCOMPRESSED_BYTES = 20_000_000;
const MAX_ZIP_ENTRIES = 2_000;

function fileError(code, message, statusCode = 400) {
  return new InventoryError(message, { code, statusCode });
}

function cellValue(cell) {
  const value = cell?.value;
  if (value && typeof value === "object" && "result" in value) return value.result;
  return value ?? "";
}

function text(value) {
  return String(value ?? "").trim();
}

function assertBoundedZip(bytes) {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) {
    throw fileError("INVENTORY_COUNT_FILE_INVALID", "Uploaded file is not a valid XLSX workbook.");
  }
  const searchStart = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw fileError("INVENTORY_COUNT_FILE_INVALID", "Uploaded file is not a valid XLSX workbook.");
  const entries = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (entries < 1 || entries > MAX_ZIP_ENTRIES || centralOffset + centralSize > eocd) {
    throw fileError("INVENTORY_COUNT_FILE_INVALID", "Uploaded workbook ZIP structure is invalid.");
  }
  let offset = centralOffset;
  let uncompressedTotal = 0;
  let compressedTotal = 0;
  const localOffsets = new Set();
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > eocd || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw fileError("INVENTORY_COUNT_FILE_INVALID", "Uploaded workbook ZIP structure is invalid.");
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const localOffset = bytes.readUInt32LE(offset + 42);
    if ((flags & 0x1) || (flags & 0x8) || ![0, 8].includes(method)
      || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw fileError("INVENTORY_COUNT_FILE_INVALID", "Uploaded workbook uses an unsupported ZIP feature.");
    }
    compressedTotal += compressedSize;
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (!name || name.startsWith("/") || name.split("/").includes("..") || localOffsets.has(localOffset)) {
      throw fileError("INVENTORY_COUNT_FILE_INVALID", "Uploaded workbook ZIP structure is invalid.");
    }
    localOffsets.add(localOffset);
    if (localOffset + 30 > centralOffset || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw fileError("INVENTORY_COUNT_FILE_INVALID", "Uploaded workbook ZIP structure is invalid.");
    }
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localMethod = bytes.readUInt16LE(localOffset + 8);
    const localCompressedSize = bytes.readUInt32LE(localOffset + 18);
    const localUncompressedSize = bytes.readUInt32LE(localOffset + 22);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    if (localFlags !== flags || localMethod !== method || localCompressedSize !== compressedSize
      || localUncompressedSize !== uncompressedSize || localNameLength !== nameLength) {
      throw fileError("INVENTORY_COUNT_FILE_INVALID", "Uploaded workbook ZIP metadata is inconsistent.");
    }
    const localName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString("utf8");
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (localName !== name || dataEnd > centralOffset) {
      throw fileError("INVENTORY_COUNT_FILE_INVALID", "Uploaded workbook ZIP structure is invalid.");
    }
    let emitted;
    try {
      const compressed = bytes.subarray(dataStart, dataEnd);
      emitted = method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, { maxOutputLength: Math.min(8_000_001, MAX_UNCOMPRESSED_BYTES - uncompressedTotal + 1) });
    } catch {
      throw fileError("INVENTORY_COUNT_FILE_TOO_COMPLEX", "Uploaded workbook expands beyond the safe processing limit.", 413);
    }
    if (emitted.length !== uncompressedSize) {
      throw fileError("INVENTORY_COUNT_FILE_INVALID", "Uploaded workbook ZIP size metadata is invalid.");
    }
    uncompressedTotal += emitted.length;
    if (emitted.length > 8_000_000 || uncompressedTotal > MAX_UNCOMPRESSED_BYTES) {
      throw fileError("INVENTORY_COUNT_FILE_TOO_COMPLEX", "Uploaded workbook expands beyond the safe processing limit.", 413);
    }
    if (/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) {
      const xml = emitted.toString("utf8");
      const rowCount = (xml.match(/<row\b/g) || []).length;
      const cellCount = (xml.match(/<c\b/g) || []).length;
      if (rowCount > 10_000 || cellCount > 100_000) {
        throw fileError("INVENTORY_COUNT_FILE_TOO_COMPLEX", "Uploaded workbook exceeds safe row or cell limits.", 413);
      }
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) {
    throw fileError("INVENTORY_COUNT_FILE_INVALID", "Uploaded workbook ZIP structure is invalid.");
  }
  if (compressedTotal < 1 || uncompressedTotal / compressedTotal > 100) {
    throw fileError("INVENTORY_COUNT_FILE_TOO_COMPLEX", "Uploaded workbook compression ratio exceeds safe processing limit.", 413);
  }
}

export function decodeInventoryCountBase64(value) {
  const encoded = String(value || "");
  const bytes = Buffer.from(encoded, "base64");
  if (!encoded || bytes.toString("base64") !== encoded) {
    throw fileError("INVENTORY_COUNT_FILE_INVALID_BASE64", "Uploaded inventory file encoding is invalid.");
  }
  return bytes;
}

export async function parseInventoryCountWorkbook(bytes) {
  assertBoundedZip(bytes);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes, { ignoreNodes: ["dataValidations"] });
  } catch {
    throw fileError("INVENTORY_COUNT_FILE_INVALID", "Uploaded file is not a valid XLSX workbook.");
  }
  const sheet = workbook.getWorksheet("Parts Inventory") || workbook.worksheets[0];
  if (!sheet) throw fileError("INVENTORY_COUNT_FILE_INVALID", "Uploaded workbook has no worksheets.");
  EXPECTED_HEADERS.forEach((expected, index) => {
    if (text(cellValue(sheet.getRow(3).getCell(index + 1))) !== expected) {
      throw fileError("INVENTORY_COUNT_FILE_TEMPLATE_MISMATCH", "Use inventory workbook with Parts Inventory columns on row 3.", 422);
    }
  });
  const rows = [];
  const lastRow = Math.min(sheet.rowCount, 10_000);
  for (let sourceRow = 4; sourceRow <= lastRow; sourceRow += 1) {
    const row = sheet.getRow(sourceRow);
    const partNumber = text(cellValue(row.getCell(1)));
    if (!partNumber) continue;
    rows.push({
      sourceRow,
      partNumber,
      partName: text(cellValue(row.getCell(2))),
      description: text(cellValue(row.getCell(4))),
      binLocation: text(cellValue(row.getCell(5))),
      quantity: cellValue(row.getCell(6)),
      averageCost: cellValue(row.getCell(12)),
    });
    if (rows.length > 500) throw fileError("INVENTORY_COUNT_TOO_MANY_ROWS", "Upload no more than 500 inventory rows.", 413);
  }
  if (!rows.length) throw fileError("INVENTORY_COUNT_FILE_EMPTY", "No parts found in Parts Inventory sheet.", 422);
  return rows;
}

function comparableRow(row) {
  return {
    sourceRow: Number(row.sourceRow),
    partNumber: text(row.partNumber),
    normalizedPartNumber: normalizePartNumber(row.partNumber),
    partName: text(row.partName),
    description: text(row.description),
    binLocation: text(row.binLocation),
    quantity: text(row.quantity),
    averageCost: text(row.averageCost),
  };
}

export function assertClientRowsMatchWorkbook(clientRows, workbookRows) {
  const client = clientRows.map(comparableRow);
  const server = workbookRows.map(comparableRow);
  if (JSON.stringify(client) !== JSON.stringify(server)) {
    throw fileError("INVENTORY_COUNT_ROWS_MISMATCH", "Submitted rows do not match uploaded workbook.", 400);
  }
}

function encryptionKey(value = process.env.INVENTORY_COUNT_FILE_ENCRYPTION_KEY || process.env.INVOICE_DOCUMENT_ENCRYPTION_KEY) {
  const raw = String(value || "").trim();
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw fileError("INVENTORY_COUNT_STORAGE_NOT_CONFIGURED", "Secure inventory file storage is not configured.", 503);
  }
  return key;
}

function currentEncryptionKeyVersion() {
  return process.env.INVENTORY_COUNT_FILE_ENCRYPTION_KEY
    ? String(process.env.INVENTORY_COUNT_FILE_ENCRYPTION_KEY_VERSION || "v1")
    : String(process.env.INVOICE_DOCUMENT_ENCRYPTION_KEY_VERSION || "v1");
}

function decryptionKey(source, options) {
  const version = String(source.source_key_version || "");
  let invoiceKeys = {};
  let inventoryKeys = {};
  try { invoiceKeys = JSON.parse(process.env.INVOICE_DOCUMENT_ENCRYPTION_KEYS || "{}"); } catch { invoiceKeys = {}; }
  try { inventoryKeys = JSON.parse(process.env.INVENTORY_COUNT_FILE_ENCRYPTION_KEYS || "{}"); } catch { inventoryKeys = {}; }
  const envKeys = { ...invoiceKeys, ...inventoryKeys };
  const versioned = options.keys?.[version] || envKeys[version];
  const currentVersion = currentEncryptionKeyVersion();
  if (!versioned && version && version !== currentVersion && !options.key) {
    throw fileError("INVENTORY_COUNT_STORAGE_KEY_UNAVAILABLE", `Inventory storage key ${version} is unavailable.`, 503);
  }
  return encryptionKey(versioned || options.key);
}

function aad({ companyId, importId, sourceSha256, contentType, sizeBytes }) {
  return Buffer.from(JSON.stringify({
    purpose: "inventory-count-source-v1",
    companyId,
    importId,
    sourceSha256,
    contentType,
    sizeBytes,
  }), "utf8");
}

export function inventoryCountSourceHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function encryptInventoryCountFile(bytes, metadata, options = {}) {
  const iv = options.iv || randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(options.key), iv);
  cipher.setAAD(aad(metadata));
  return {
    ciphertext: Buffer.concat([cipher.update(bytes), cipher.final()]),
    iv: Buffer.from(iv),
    authTag: cipher.getAuthTag(),
    keyVersion: String(options.keyVersion || currentEncryptionKeyVersion()),
  };
}

export function decryptInventoryCountFile(source, options = {}) {
  try {
    const decipher = createDecipheriv("aes-256-gcm", decryptionKey(source, options), source.source_iv);
    decipher.setAAD(aad({
      companyId: source.company_id,
      importId: source.id,
      sourceSha256: source.source_sha256,
      contentType: source.source_content_type,
      sizeBytes: Number(source.source_size_bytes),
    }));
    decipher.setAuthTag(source.source_auth_tag);
    const plaintext = Buffer.concat([decipher.update(source.source_ciphertext), decipher.final()]);
    if (plaintext.length !== Number(source.source_size_bytes) || inventoryCountSourceHash(plaintext) !== source.source_sha256) throw new Error("integrity mismatch");
    return plaintext;
  } catch (error) {
    if (error instanceof InventoryError) throw error;
    throw fileError("INVENTORY_COUNT_FILE_INTEGRITY_FAILED", "Stored inventory file failed integrity verification.", 500);
  }
}

export function inventoryCountContentType() {
  return XLSX_CONTENT_TYPE;
}
