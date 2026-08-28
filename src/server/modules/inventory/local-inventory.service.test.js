import assert from "node:assert/strict";
import test from "node:test";
import {
  postReviewedInvoiceToLocalInventory,
  readLocalInvoiceHistory,
  readLocalInventoryStock,
} from "./local-inventory.service.js";

const COMPANY_ID = "00000000-0000-4000-8000-000000000101";
const LOCATION_ID = "00000000-0000-4000-8000-000000000102";
const OTHER_LOCATION_ID = "00000000-0000-4000-8000-000000000103";
const ACTOR_ID = "00000000-0000-4000-8000-000000000104";
const RUN_ID = "00000000-0000-4000-8000-000000000105";
const SIGNING_KEY = Buffer.alloc(32, 23).toString("base64");

function context(role = "office") {
  return {
    actor: { id: ACTOR_ID, role },
    companyIds: new Set([COMPANY_ID]),
    locationIds: new Set([LOCATION_ID]),
  };
}

function reviewedInvoice(overrides = {}) {
  return {
    id: RUN_ID,
    company_id: COMPANY_ID,
    location_id: LOCATION_ID,
    status: "reviewed",
    version: 3,
    reviewed_draft: {
      documentType: { value: "invoice", confidence: 100, evidence: "Invoice" },
      vendorName: { value: "Local Vendor", confidence: 100, evidence: "Vendor" },
      vendorAccount: { value: "", confidence: 100, evidence: "" },
      invoiceNumber: { value: "INV-1", confidence: 100, evidence: "Number" },
      invoiceDate: { value: "2026-08-25", confidence: 100, evidence: "Date" },
      purchaseOrderNumber: { value: "", confidence: 100, evidence: "" },
      currency: { value: "USD", confidence: 100, evidence: "USD" },
      subtotal: { value: 20, confidence: 100, evidence: "Subtotal" },
      tax: { value: 0, confidence: 100, evidence: "Tax" },
      shipping: { value: 0, confidence: 100, evidence: "Shipping" },
      total: { value: 20, confidence: 100, evidence: "Total" },
      lines: [{
        id: "line-1",
        partNumber: { value: "FILTER-1", confidence: 100, evidence: "Part" },
        description: { value: "Oil filter", confidence: 100, evidence: "Description" },
        quantity: { value: 2, confidence: 100, evidence: "Quantity" },
        unitOfMeasure: { value: "ea", confidence: 100, evidence: "Unit" },
        unitPrice: { value: 10, confidence: 100, evidence: "Price" },
        lineTotal: { value: 20, confidence: 100, evidence: "Line total" },
      }],
      warnings: [],
    },
    ...overrides,
  };
}

test("posts a reviewed invoice to local inventory without provider dependencies", async () => {
  let posted;
  const result = await postReviewedInvoiceToLocalInventory(
    RUN_ID,
    { idempotencyKey: "local-receipt-1", expectedVersion: 3, confirmation: "all_received_undamaged" },
    context(),
    {
      loadInvoice: async () => reviewedInvoice(),
      postReceipt: async (input) => {
        posted = input;
        return {
          kind: "posted",
          receipt: {
            id: input.receiptId,
            status: "posted",
            lineCount: input.lines.length,
            units: input.lines.flatMap((line) => line.serializedUnits.map((unit) => ({
              ...unit,
              receiptLineId: line.id,
              partNumber: line.partNumber,
              description: line.description,
              status: "in_stock",
            }))),
          },
        };
      },
      qrOptions: { signingKey: SIGNING_KEY, origin: "https://inventory.example.test" },
    },
  );
  assert.equal(result.receipt.status, "posted");
  assert.equal(result.replayed, false);
  assert.equal(posted.companyIds[0], COMPANY_ID);
  assert.equal(posted.locationIds[0], LOCATION_ID);
  assert.equal(posted.lines[0].normalizedPartNumber, "FILTER1");
  assert.equal(posted.lines[0].quantity, 2);
  assert.equal(posted.lines[0].uomCode, "ea");
  assert.equal(posted.lines[0].serializedUnits.length, 2);
  assert.match(posted.lines[0].serializedUnits[0].serialNumber, /^WG-L-[A-F0-9]{16}-1-1$/);
  assert.equal(result.receipt.units.length, 2);
  assert.match(result.receipt.units[0].scanUrl, /^https:\/\/inventory\.example\.test/);
  assert.match(posted.requestHash, /^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(posted, "provider"), false);
});

test("returns the existing receipt for an exact idempotent replay", async () => {
  const result = await postReviewedInvoiceToLocalInventory(
    RUN_ID,
    { idempotencyKey: "local-receipt-replay", expectedVersion: 3, confirmation: "all_received_undamaged" },
    context(),
    {
      loadInvoice: async () => reviewedInvoice(),
      postReceipt: async () => ({ kind: "replay", receipt: { id: "receipt-1", status: "posted", units: [] } }),
    },
  );
  assert.equal(result.replayed, true);
  assert.equal(result.receipt.id, "receipt-1");
});

test("rejects a changed request behind an already-used receipt identity", async () => {
  await assert.rejects(
    postReviewedInvoiceToLocalInventory(
      RUN_ID,
      { idempotencyKey: "local-receipt-conflict", expectedVersion: 3, confirmation: "all_received_undamaged" },
      context(),
      {
        loadInvoice: async () => reviewedInvoice(),
        postReceipt: async () => ({ kind: "conflict" }),
        qrOptions: { signingKey: SIGNING_KEY },
      },
    ),
    (error) => error.code === "INVENTORY_RECEIPT_REPLAY_CONFLICT" && error.statusCode === 409,
  );
});

test("measured quantities stay aggregate and do not receive invented serial identities", async () => {
  const invoice = reviewedInvoice();
  invoice.reviewed_draft.lines[0].quantity.value = 2.5;
  invoice.reviewed_draft.lines[0].unitOfMeasure.value = "gal";
  let posted;
  await postReviewedInvoiceToLocalInventory(
    RUN_ID,
    { idempotencyKey: "local-measured-quantity", expectedVersion: 3, confirmation: "all_received_undamaged" },
    context(),
    {
      loadInvoice: async () => invoice,
      postReceipt: async (input) => {
        posted = input;
        return { kind: "posted", receipt: { id: input.receiptId, status: "posted", units: [] } };
      },
    },
  );
  assert.deepEqual(posted.lines[0].serializedUnits, []);
});

test("hides an invoice assigned outside the office user's locations", async () => {
  await assert.rejects(
    postReviewedInvoiceToLocalInventory(
      RUN_ID,
      { idempotencyKey: "local-receipt-scope", expectedVersion: 3, confirmation: "all_received_undamaged" },
      context(),
      { loadInvoice: async () => reviewedInvoice({ location_id: OTHER_LOCATION_ID }) },
    ),
    (error) => error.statusCode === 404 && error.code === "inventory_not_found",
  );
});

test("rejects unsupported units before any inventory write", async () => {
  let wrote = false;
  const invoice = reviewedInvoice();
  invoice.reviewed_draft.lines[0].unitOfMeasure.value = "pallets";
  await assert.rejects(
    postReviewedInvoiceToLocalInventory(
      RUN_ID,
      { idempotencyKey: "local-receipt-uom", expectedVersion: 3, confirmation: "all_received_undamaged" },
      context(),
      { loadInvoice: async () => invoice, postReceipt: async () => { wrote = true; } },
    ),
    (error) => error.code === "INVENTORY_UOM_INVALID",
  );
  assert.equal(wrote, false);
});

test("requires the full-delivery attestation before inventory write", async () => {
  let wrote = false;
  await assert.rejects(
    postReviewedInvoiceToLocalInventory(
      RUN_ID,
      { idempotencyKey: "local-missing-attestation", expectedVersion: 3 },
      context(),
      { loadInvoice: async () => reviewedInvoice(), postReceipt: async () => { wrote = true; } },
    ),
    (error) => error.name === "ZodError",
  );
  assert.equal(wrote, false);
});

test("rejects a stale reviewed version before inventory write", async () => {
  let wrote = false;
  await assert.rejects(
    postReviewedInvoiceToLocalInventory(
      RUN_ID,
      { idempotencyKey: "local-stale-version", expectedVersion: 2, confirmation: "all_received_undamaged" },
      context(),
      { loadInvoice: async () => reviewedInvoice(), postReceipt: async () => { wrote = true; } },
    ),
    (error) => error.code === "INVOICE_REVIEW_STALE" && error.statusCode === 409,
  );
  assert.equal(wrote, false);
});

test("surfaces reserved legacy balance authority conflicts", async () => {
  await assert.rejects(
    postReviewedInvoiceToLocalInventory(
      RUN_ID,
      { idempotencyKey: "local-authority-conflict", expectedVersion: 3, confirmation: "all_received_undamaged" },
      context(),
      { loadInvoice: async () => reviewedInvoice(), postReceipt: async () => ({ kind: "authority_conflict" }), qrOptions: { signingKey: SIGNING_KEY } },
    ),
    (error) => error.code === "INVENTORY_AUTHORITY_CONFLICT"
      && error.statusCode === 409
      && /reserved stock/i.test(error.message),
  );
});

test("does not write countable inventory when QR signing is unavailable", async () => {
  let wrote = false;
  await assert.rejects(
    postReviewedInvoiceToLocalInventory(
      RUN_ID,
      { idempotencyKey: "local-missing-qr", expectedVersion: 3, confirmation: "all_received_undamaged" },
      context(),
      {
        loadInvoice: async () => reviewedInvoice(),
        postReceipt: async () => { wrote = true; },
        qrOptions: { signingKey: "invalid" },
      },
    ),
    (error) => error.code === "inventory_qr_not_configured" && error.statusCode === 503,
  );
  assert.equal(wrote, false);
});

test("Office stock reads may select any location inside an authorized company", async () => {
  let input;
  await readLocalInventoryStock(
    new URLSearchParams({ locationId: OTHER_LOCATION_ID }),
    context(),
    { listStock: async (nextInput) => { input = nextInput; return []; } },
  );
  assert.equal(input.locationId, OTHER_LOCATION_ID);
  assert.deepEqual(input.companyIds, [COMPANY_ID]);
  assert.equal(input.isAdmin, true);
  assert.equal(input.sort, "available_desc");
});

test("Office stock reads forward the requested server-side sort before pagination", async () => {
  const inputs = [];
  await readLocalInventoryStock(
    new URLSearchParams({ sort: "reserved_desc", page: "3", limit: "20" }),
    context(),
    { listStock: async (nextInput) => { inputs.push(nextInput); return []; } },
  );
  assert.equal(inputs[0].sort, "reserved_desc");
  assert.equal(inputs[0].limit, 20);
  assert.equal(inputs[0].offset, 40);
});

test("invoice history keeps Office location scope and forwards bounded server pagination", async () => {
  let input;
  const result = await readLocalInvoiceHistory(
    new URLSearchParams({ q: "  Rush  ", status: "reviewed", page: "2", limit: "20" }),
    context(),
    {
      listHistory: async (nextInput) => {
        input = nextInput;
        return { items: [{ id: RUN_ID }], total: 41 };
      },
    },
  );
  assert.deepEqual(input.companyIds, [COMPANY_ID]);
  assert.deepEqual(input.locationIds, [LOCATION_ID]);
  assert.equal(input.isAdmin, false);
  assert.equal(input.queryText, "Rush");
  assert.equal(input.status, "reviewed");
  assert.equal(input.limit, 20);
  assert.equal(input.offset, 20);
  assert.deepEqual(result, { invoices: [{ id: RUN_ID }], page: 2, limit: 20, total: 41, pageCount: 3 });
});

test("invoice history rejects invalid pagination before repository access", async () => {
  let queried = false;
  await assert.rejects(
    readLocalInvoiceHistory(
      new URLSearchParams({ page: "0", limit: "101", status: "unknown" }),
      context(),
      { listHistory: async () => { queried = true; return []; } },
    ),
    (error) => error.name === "ZodError",
  );
  assert.equal(queried, false);
});
