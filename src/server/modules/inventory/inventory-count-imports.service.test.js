import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  confirmInventoryCount,
  readInventoryCounts,
  searchInventoryMasterParts,
  uploadInventoryCount,
  inventoryCountInternals,
} from "./inventory-count-imports.service.js";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const COMPANY_ID = "20000000-0000-4000-8000-000000000002";
const LOCATION_ID = "30000000-0000-4000-8000-000000000003";

function context(overrides = {}) {
  return {
    actor: { id: ACTOR_ID, role: "office", ...overrides.actor },
    companyIds: new Set(overrides.companyIds || [COMPANY_ID]),
    locationIds: new Set(overrides.locationIds || [LOCATION_ID]),
  };
}

test("inventory count parsing keeps nonnumeric package text as a visible exception", () => {
  const [row] = inventoryCountInternals.prepareRows([{
    sourceRow: 20,
    partNumber: "KAL-179.1012K",
    partName: "Gladhand seal kit",
    description: "",
    binLocation: "A1-B1-S2",
    quantity: "12 pack",
    averageCost: null,
  }]);
  assert.equal(row.normalizedPartNumber, "KAL1791012K");
  assert.equal(row.quantityText, "12 pack");
  assert.equal(row.quantity, null);
});

test("inventory count parsing rejects duplicate spreadsheet row identities", () => {
  const row = { sourceRow: 4, partNumber: "ABC-1", partName: "", description: "", binLocation: "", quantity: 2, averageCost: null };
  assert.throws(() => inventoryCountInternals.prepareRows([row, row]), /row 4 was uploaded more than once/i);
});

test("upload forwards only bounded normalized count evidence and actor scope", async () => {
  let received;
  const bytes = Buffer.from("test");
  const result = await uploadInventoryCount({
    locationId: LOCATION_ID,
    sourceFileName: "count.xlsx",
    sourceContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sourceSizeBytes: bytes.length,
    sourceFileBase64: bytes.toString("base64"),
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    rows: [{ sourceRow: 4, partNumber: "ABC-1", partName: "Filter", quantity: 3 }],
  }, context(), {
    parseWorkbook: async () => [{ sourceRow: 4, partNumber: "ABC-1", partName: "Filter", quantity: 3 }],
    findLocation: async () => ({ id: LOCATION_ID, company_id: COMPANY_ID }),
    encryptFile: () => ({ ciphertext: bytes, iv: Buffer.alloc(12), authTag: Buffer.alloc(16), keyVersion: "test-v1" }),
    createImport: async (input) => {
      received = input;
      return { kind: "created", import: { id: "draft-1" } };
    },
  });
  assert.equal(result.import.id, "draft-1");
  assert.equal(received.actorId, ACTOR_ID);
  assert.deepEqual(received.companyIds, [COMPANY_ID]);
  assert.deepEqual(received.locationIds, [LOCATION_ID]);
  assert.equal(received.rows[0].normalizedPartNumber, "ABC1");
  assert.equal(received.rows[0].quantity, 3);
});

test("upload rejects client hash mismatch before parsing or persistence", async () => {
  let parsed = false;
  let wrote = false;
  const bytes = Buffer.from("test");
  await assert.rejects(
    uploadInventoryCount({
      locationId: LOCATION_ID,
      sourceFileName: "count.xlsx",
      sourceContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sourceSizeBytes: bytes.length,
      sourceFileBase64: bytes.toString("base64"),
      sourceSha256: "a".repeat(64),
      rows: [{ sourceRow: 4, partNumber: "ABC-1", quantity: 3 }],
    }, context(), {
      parseWorkbook: async () => { parsed = true; return []; },
      createImport: async () => { wrote = true; return { kind: "created" }; },
    }),
    (error) => error.code === "INVENTORY_COUNT_FILE_HASH_MISMATCH",
  );
  assert.equal(parsed, false);
  assert.equal(wrote, false);
});

test("inventory master endpoint derives scope and always requests full catalog matching", async () => {
  let searched;
  const result = await searchInventoryMasterParts(new URLSearchParams({ q: "filter", locationId: LOCATION_ID }), context(), {
    findLocation: async (scope) => {
      assert.deepEqual(scope.companyIds, [COMPANY_ID]);
      assert.deepEqual(scope.locationIds, [LOCATION_ID]);
      return { id: LOCATION_ID, company_id: COMPANY_ID };
    },
    searchCatalog: async (companyId, input) => {
      searched = { companyId, input };
      return { catalogAvailable: true, items: [] };
    },
  });
  assert.deepEqual(result, { catalogAvailable: true, items: [] });
  assert.deepEqual(searched, {
    companyId: COMPANY_ID,
    input: {
      text: "filter",
      locationId: LOCATION_ID,
      limit: 8,
      purpose: "master_match",
    },
  });
});

test("inventory count browser returns server pagination metadata", async () => {
  let input;
  const result = await readInventoryCounts(new URLSearchParams({ page: "3", pageSize: "10" }), context(), {
    listImports: async (nextInput) => {
      input = nextInput;
      return { imports: [{ id: "import-21" }], total: 24 };
    },
  });
  assert.equal(input.limit, 10);
  assert.equal(input.offset, 20);
  assert.deepEqual(result, { imports: [{ id: "import-21" }], page: 3, pageSize: 10, pageCount: 3, total: 24 });
});

test("apply requires explicit physical count and reports existing-stock conflict", async () => {
  await assert.rejects(
    confirmInventoryCount("draft-1", { expectedVersion: 1, confirmation: "looks_good" }, context({ actor: { role: "admin" } })),
    /Invalid input|Invalid/i,
  );
  await assert.rejects(
    confirmInventoryCount("draft-1", { expectedVersion: 1, confirmation: "physically_counted" }, context({ actor: { role: "admin" } }), {
      qrOptions: { secret: "test-secret-test-secret-test-secret", origin: "http://localhost:4173" },
      applyImport: async () => ({ kind: "stock_conflict", sourceRow: 37 }),
    }),
    (error) => error.code === "INVENTORY_COUNT_STOCK_CONFLICT" && /row 37/.test(error.message),
  );
});

test("opening-count apply rejects office role before any repository write", async () => {
  let wrote = false;
  await assert.rejects(
    confirmInventoryCount("draft-1", { expectedVersion: 1, confirmation: "physically_counted" }, context(), {
      qrOptions: { signingKey: Buffer.alloc(32, 4).toString("base64") },
      applyImport: async () => { wrote = true; return { kind: "applied" }; },
    }),
    (error) => error.code === "INVENTORY_COUNT_APPLY_FORBIDDEN" && error.statusCode === 403,
  );
  assert.equal(wrote, false);
});

test("opening-count apply blocks Odoo authority", async () => {
  const admin = context({ actor: { role: "admin" } });
  const qrOptions = { signingKey: Buffer.alloc(32, 4).toString("base64") };
  await assert.rejects(
    confirmInventoryCount("draft-1", { expectedVersion: 1, confirmation: "physically_counted" }, admin, {
      qrOptions,
      applyImport: async () => ({ kind: "odoo_authority_conflict", sourceRow: 8 }),
    }),
    (error) => error.code === "INVENTORY_COUNT_ODOO_AUTHORITY_CONFLICT" && /Odoo-managed/.test(error.message),
  );
});
