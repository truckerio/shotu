import assert from "node:assert/strict";
import test from "node:test";
import { handleInventoryApi } from "./inventory.routes.js";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const LOCATION_ID = "00000000-0000-4000-8000-000000000002";
const ACTOR_ID = "00000000-0000-4000-8000-000000000003";
const RUN_ID = "00000000-0000-4000-8000-000000000004";

function context() {
  return {
    actor: { id: ACTOR_ID, role: "office" },
    companyIds: new Set([COMPANY_ID]),
    locationIds: new Set([LOCATION_ID]),
  };
}

function helpers(body, requestContext = context()) {
  return {
    requestContext,
    readBody: async () => body,
    sendJson: (res, status, payload) => Object.assign(res, { status, payload }),
  };
}

test("receive route crosses the real handler boundary and returns a confirmed receipt", async () => {
  const response = {};
  const handled = await handleInventoryApi(
    { method: "POST" },
    response,
    new URL(`http://localhost/api/office/invoice-extractions/${RUN_ID}/receive`),
    helpers({ idempotencyKey: "route-receive-1" }),
    {
      loadInvoice: async () => ({
        id: RUN_ID,
        company_id: COMPANY_ID,
        location_id: LOCATION_ID,
        status: "reviewed",
        reviewed_draft: {
          documentType: { value: "invoice", confidence: 100, evidence: "test" },
          vendorName: { value: "QA", confidence: 100, evidence: "test" },
          vendorAccount: { value: "", confidence: 100, evidence: "test" },
          invoiceNumber: { value: "QA-1", confidence: 100, evidence: "test" },
          invoiceDate: { value: "2026-08-25", confidence: 100, evidence: "test" },
          purchaseOrderNumber: { value: "", confidence: 100, evidence: "test" },
          currency: { value: "USD", confidence: 100, evidence: "test" },
          subtotal: { value: 10, confidence: 100, evidence: "test" },
          tax: { value: 0, confidence: 100, evidence: "test" },
          shipping: { value: 0, confidence: 100, evidence: "test" },
          total: { value: 10, confidence: 100, evidence: "test" },
          lines: [{
            id: "line-1",
            partNumber: { value: "QA-1", confidence: 100, evidence: "test" },
            description: { value: "QA serialized unit", confidence: 100, evidence: "test" },
            quantity: { value: 1, confidence: 100, evidence: "test" },
            unitOfMeasure: { value: "ea", confidence: 100, evidence: "test" },
            unitPrice: { value: 10, confidence: 100, evidence: "test" },
            lineTotal: { value: 10, confidence: 100, evidence: "test" },
          }],
          warnings: [],
        },
      }),
      loadMappings: async () => [{
        catalog_part_id: "00000000-0000-4000-8000-000000000005",
        normalized_part_number: "QA1",
        product_external_id: "99",
        uom_code: "ea",
      }],
      loadLocations: async () => ["471"],
      readConfiguration: async () => ({ database: "qa" }),
      createClient: () => ({}),
      inspectProvider: async (_client, { lines }) => ({
        pickingTypeId: 245,
        sourceLocationId: 4,
        destinationLocationId: 471,
        products: lines.map((line) => ({ ...line, productExternalId: 99, productName: line.description, uomExternalId: 1 })),
      }),
      stageReceipt: async (input) => ({
        inserted: true,
        providerRoute: input.providerRoute,
        receipt: {
          id: input.receiptId,
          invoiceRunId: RUN_ID,
          locationId: LOCATION_ID,
          locationName: "Chino Yard",
          status: "pending",
          version: 1,
          provider: "odoo",
          providerPickingName: "",
          lines: input.lines,
          units: input.units.map((unit) => ({ ...unit, status: "pending", partNumber: "QA-1", description: "QA serialized unit" })),
        },
      }),
      claimCommand: async () => true,
      ensureProviderReceipt: async (_client, { context: providerContext }) => ({
        pickingExternalId: "800",
        pickingName: "CHI/IN/QA",
        state: "done",
        lots: providerContext.products.flatMap((line) => line.serials.map((serial) => ({ externalId: "900", serialNumber: serial }))),
      }),
      confirmReceipt: async ({ providerResult }) => ({
        id: "00000000-0000-4000-8000-000000000006",
        status: "confirmed",
        providerPickingName: providerResult.pickingName,
        lines: [],
        units: [],
      }),
      qrOptions: { signingKey: Buffer.alloc(32, 7).toString("base64"), origin: "https://example.test" },
    },
  );

  assert.equal(handled, true);
  assert.equal(response.status, 200);
  assert.equal(response.payload.receipt.status, "confirmed");
  assert.equal(response.payload.receipt.providerPickingName, "CHI/IN/QA");
});

test("scan route hides malformed or tampered identities behind a stable 404", async () => {
  const response = {};
  await handleInventoryApi(
    { method: "POST" },
    response,
    new URL("http://localhost/api/inventory/resolve"),
    helpers({ code: "not-a-valid-signed-code" }),
    { qrOptions: { signingKey: Buffer.alloc(32, 7).toString("base64") } },
  );
  assert.equal(response.status, 404);
  assert.deepEqual(response.payload, {
    error: "Inventory identity was not found.",
    code: "inventory_not_found",
    retryable: false,
  });
});
