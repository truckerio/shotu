import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  assertClientRowsMatchWorkbook,
  decryptInventoryCountFile,
  encryptInventoryCountFile,
  inventoryCountSourceHash,
  parseInventoryCountWorkbook,
} from "./inventory-count-file.js";

async function workbookBytes() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Parts Inventory");
  ["Part #", "Part Name", "Category", "Fits / Description", "Bin / Shelf", "Opening Qty"]
    .forEach((header, index) => { sheet.getRow(3).getCell(index + 1).value = header; });
  sheet.getRow(4).getCell(1).value = "ABC-1";
  sheet.getRow(4).getCell(2).value = "Filter";
  sheet.getRow(4).getCell(4).value = "Oil filter";
  sheet.getRow(4).getCell(5).value = "A-1";
  sheet.getRow(4).getCell(6).value = 3;
  sheet.getRow(4).getCell(12).value = 12.5;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test("server parses bounded XLSX source and binds submitted rows", async () => {
  const rows = await parseInventoryCountWorkbook(await workbookBytes());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].partNumber, "ABC-1");
  assert.equal(rows[0].quantity, 3);
  assert.doesNotThrow(() => assertClientRowsMatchWorkbook(rows, rows));
  assert.throws(
    () => assertClientRowsMatchWorkbook([{ ...rows[0], quantity: 4 }], rows),
    (error) => error.code === "INVENTORY_COUNT_ROWS_MISMATCH",
  );
});

test("server rejects non-XLSX bytes before ExcelJS parsing", async () => {
  await assert.rejects(
    parseInventoryCountWorkbook(Buffer.from("not a zip")),
    (error) => error.code === "INVENTORY_COUNT_FILE_INVALID" && error.statusCode === 400,
  );
});

test("server rejects forged ZIP uncompressed sizes using actual emitted bytes", async () => {
  const bytes = await workbookBytes();
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  let central = bytes.readUInt32LE(eocd + 16);
  const entries = bytes.readUInt16LE(eocd + 10);
  let forged = false;
  for (let index = 0; index < entries; index += 1) {
    const method = bytes.readUInt16LE(central + 10);
    const size = bytes.readUInt32LE(central + 24);
    if (method === 8 && size > 1) {
      const local = bytes.readUInt32LE(central + 42);
      bytes.writeUInt32LE(1, central + 24);
      bytes.writeUInt32LE(1, local + 22);
      forged = true;
      break;
    }
    central += 46 + bytes.readUInt16LE(central + 28) + bytes.readUInt16LE(central + 30) + bytes.readUInt16LE(central + 32);
  }
  assert.equal(forged, true);
  await assert.rejects(
    parseInventoryCountWorkbook(bytes),
    (error) => ["INVENTORY_COUNT_FILE_INVALID", "INVENTORY_COUNT_FILE_TOO_COMPLEX"].includes(error.code),
  );
});

test("inventory XLSX encryption binds tenant metadata and detects tampering", async () => {
  const bytes = await workbookBytes();
  const key = Buffer.alloc(32, 9).toString("base64");
  const metadata = {
    companyId: "company-1",
    importId: "import-1",
    sourceSha256: inventoryCountSourceHash(bytes),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: bytes.length,
  };
  const encrypted = encryptInventoryCountFile(bytes, metadata, { key, keyVersion: "test-v1", iv: Buffer.alloc(12, 3) });
  const source = {
    id: metadata.importId,
    company_id: metadata.companyId,
    source_sha256: metadata.sourceSha256,
    source_content_type: metadata.contentType,
    source_size_bytes: metadata.sizeBytes,
    source_ciphertext: encrypted.ciphertext,
    source_iv: encrypted.iv,
    source_auth_tag: encrypted.authTag,
    source_key_version: encrypted.keyVersion,
  };
  assert.deepEqual(decryptInventoryCountFile(source, { key }), bytes);
  assert.deepEqual(decryptInventoryCountFile(source, { keys: { "test-v1": key } }), bytes);
  assert.throws(
    () => decryptInventoryCountFile({ ...source, company_id: "company-2" }, { key }),
    (error) => error.code === "INVENTORY_COUNT_FILE_INTEGRITY_FAILED",
  );
});

test("inventory decrypt retains historical invoice fallback keys across rotation", async () => {
  const names = [
    "INVENTORY_COUNT_FILE_ENCRYPTION_KEY",
    "INVENTORY_COUNT_FILE_ENCRYPTION_KEY_VERSION",
    "INVENTORY_COUNT_FILE_ENCRYPTION_KEYS",
    "INVOICE_DOCUMENT_ENCRYPTION_KEY",
    "INVOICE_DOCUMENT_ENCRYPTION_KEY_VERSION",
    "INVOICE_DOCUMENT_ENCRYPTION_KEYS",
  ];
  const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const oldKey = Buffer.alloc(32, 5).toString("base64");
  const newKey = Buffer.alloc(32, 6).toString("base64");
  const bytes = Buffer.from("historical inventory evidence");
  const metadata = {
    companyId: "company-rotation",
    importId: "import-rotation",
    sourceSha256: inventoryCountSourceHash(bytes),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: bytes.length,
  };
  const encrypted = encryptInventoryCountFile(bytes, metadata, { key: oldKey, keyVersion: "invoice-v1" });
  try {
    delete process.env.INVENTORY_COUNT_FILE_ENCRYPTION_KEY;
    process.env.INVENTORY_COUNT_FILE_ENCRYPTION_KEY_VERSION = "orphan-inventory-version";
    delete process.env.INVENTORY_COUNT_FILE_ENCRYPTION_KEYS;
    process.env.INVOICE_DOCUMENT_ENCRYPTION_KEY = newKey;
    process.env.INVOICE_DOCUMENT_ENCRYPTION_KEY_VERSION = "invoice-v2";
    process.env.INVOICE_DOCUMENT_ENCRYPTION_KEYS = JSON.stringify({ "invoice-v1": oldKey });
    const current = encryptInventoryCountFile(bytes, metadata, { iv: Buffer.alloc(12, 7) });
    assert.equal(current.keyVersion, "invoice-v2", "fallback key and version must come from the same invoice configuration");
    assert.deepEqual(decryptInventoryCountFile({
      id: metadata.importId,
      company_id: metadata.companyId,
      source_sha256: metadata.sourceSha256,
      source_content_type: metadata.contentType,
      source_size_bytes: metadata.sizeBytes,
      source_ciphertext: encrypted.ciphertext,
      source_iv: encrypted.iv,
      source_auth_tag: encrypted.authTag,
      source_key_version: encrypted.keyVersion,
    }), bytes);
  } finally {
    for (const name of names) {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    }
  }
});
