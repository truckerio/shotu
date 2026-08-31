import test from "node:test";
import assert from "node:assert/strict";
import { receiveReviewedInvoice, resolveInventoryCode } from "./inventory-receiving.service.js";
import { createInventoryQrToken } from "./inventory-qr.js";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const LOCATION_ID = "00000000-0000-4000-8000-000000000002";
const RUN_ID = "00000000-0000-4000-8000-000000000003";
const ACTOR_ID = "00000000-0000-4000-8000-000000000004";
const SIGNING_KEY = Buffer.alloc(32, 23).toString("base64");

function field(value) {
  return { value, confidence: 100, evidence: "synthetic test" };
}

function draft(quantity = 2) {
  return {
    documentType: field("invoice"), vendorName: field("QA Vendor"), vendorAccount: field(""),
    invoiceNumber: field("QA-INV-1"), invoiceDate: field("2026-08-25"), purchaseOrderNumber: field(""),
    currency: field("USD"), subtotal: field(20), tax: field(0), shipping: field(0), total: field(20),
    lines: [{
      id: "line-1", partNumber: field("QA-QR-001"), description: field("Synthetic serialized filter"),
      quantity: field(quantity), unitOfMeasure: field("ea"), unitPrice: field(10), lineTotal: field(20),
    }],
    warnings: [],
  };
}

function context(role = "office") {
  return {
    actor: { id: ACTOR_ID, role },
    companyIds: new Set([COMPANY_ID]),
    locationIds: new Set([LOCATION_ID]),
  };
}

test.skip("legacy: reviewed invoice waits for Odoo confirmation before returning encrypted labels", async () => {
  let stagedInput;
  let providerContext;
  const result = await receiveReviewedInvoice(RUN_ID, { idempotencyKey: "receive-test-1" }, context(), {
    loadInvoice: async () => ({ id: RUN_ID, company_id: COMPANY_ID, location_id: LOCATION_ID, status: "reviewed", reviewed_draft: draft() }),
    loadMappings: async () => [{
      catalog_part_id: "00000000-0000-4000-8000-000000000005",
      normalized_part_number: "QAQR001", part_number: "QA-QR-001", description: "Synthetic serialized filter",
      uom_code: "ea", product_external_id: "99", display_name: "QA product", active: true,
    }],
    loadLocations: async () => ["471"],
    readConfiguration: async () => ({ database: "qa" }),
    createClient: () => ({}),
    inspectProvider: async (_client, input) => ({
      pickingTypeId: 245, sourceLocationId: 4, destinationLocationId: 471,
      products: input.lines.map((line) => ({ ...line, productExternalId: 99, productName: line.description, uomExternalId: 1 })),
    }),
    stageReceipt: async (input) => {
      stagedInput = input;
      return {
        inserted: true,
        providerRoute: input.providerRoute,
        receipt: {
          id: input.receiptId, invoiceRunId: RUN_ID, locationId: LOCATION_ID, locationName: "Chino shop",
          status: "pending", version: 1, provider: "odoo", providerPickingExternalId: null,
          providerPickingName: "", errorCode: null, createdAt: new Date().toISOString(), confirmedAt: null,
          lines: input.lines.map((line) => ({
            id: line.id, lineIndex: line.lineIndex, catalogPartId: line.catalogPartId,
            productExternalId: line.productExternalId, partNumber: line.partNumber,
            description: line.description, quantity: line.quantity, uomCode: line.uomCode, trackingMode: "serial",
          })),
          units: input.units.map((unit) => ({
            id: unit.id, receiptLineId: unit.receiptLineId, ordinal: unit.ordinal,
            serialNumber: unit.serialNumber, status: "pending", partNumber: "QA-QR-001", description: "Synthetic serialized filter",
          })),
        },
      };
    },
    claimCommand: async () => true,
    ensureProviderReceipt: async (_client, input) => {
      providerContext = input.context;
      return {
        pickingExternalId: "800", pickingName: "CHI/IN/QA", state: "done",
        lots: input.context.products.flatMap((line) => line.serials.map((serial, index) => ({ externalId: String(900 + index), serialNumber: serial }))),
      };
    },
    confirmReceipt: async ({ providerResult }) => ({
      ...await (async () => {
        const receipt = {
          id: stagedInput.receiptId, invoiceRunId: RUN_ID, locationId: LOCATION_ID, locationName: "Chino shop",
          status: "confirmed", version: 2, provider: "odoo", providerPickingExternalId: providerResult.pickingExternalId,
          providerPickingName: providerResult.pickingName, errorCode: null, createdAt: new Date().toISOString(), confirmedAt: new Date().toISOString(),
          lines: stagedInput.lines.map((line) => ({ ...line })),
          units: stagedInput.units.map((unit, index) => ({ ...unit, status: "in_stock", providerLotExternalId: String(900 + index), partNumber: "QA-QR-001", description: "Synthetic serialized filter" })),
        };
        return receipt;
      })(),
    }),
    qrOptions: { signingKey: SIGNING_KEY, origin: "https://workorders.example.test" },
  });
  assert.equal(providerContext.products[0].serials.length, 2);
  assert.equal(result.receipt.status, "confirmed");
  assert.equal(result.receipt.units.length, 2);
  assert.match(result.receipt.units[0].scanUrl, /^https:\/\/workorders\.example\.test\/\?inventoryScan=/);
  assert.equal(result.receipt.units[0].scanUrl.includes("QA-QR-001"), false);
});

test.skip("legacy: fractional invoice quantity is rejected before any provider write", async () => {
  let providerInspected = false;
  await assert.rejects(
    receiveReviewedInvoice(RUN_ID, { idempotencyKey: "receive-test-2" }, context(), {
      loadInvoice: async () => ({ id: RUN_ID, company_id: COMPANY_ID, location_id: LOCATION_ID, status: "reviewed", reviewed_draft: draft(1.5) }),
      loadMappings: async () => [{ catalog_part_id: ACTOR_ID, normalized_part_number: "QAQR001", product_external_id: "99", uom_code: "ea" }],
      inspectProvider: async (_client, { lines }) => {
        providerInspected = true;
        return {
          pickingTypeId: 245,
          sourceLocationId: 4,
          destinationLocationId: 471,
          products: lines.map((line) => ({ ...line, productExternalId: 99, uomExternalId: 1 })),
        };
      },
      qrOptions: { signingKey: SIGNING_KEY },
    }),
    (error) => error.code === "INVENTORY_SERIAL_QUANTITY_INVALID",
  );
  assert.equal(providerInspected, false);
});

test.skip("legacy: receipt-wide serialized-unit cap rejects an RPC and database amplification attempt", async () => {
  let staged = false;
  let providerInspected = false;
  await assert.rejects(
    receiveReviewedInvoice(RUN_ID, { idempotencyKey: "receive-test-cap" }, context(), {
      loadInvoice: async () => ({ id: RUN_ID, company_id: COMPANY_ID, location_id: LOCATION_ID, status: "reviewed", reviewed_draft: draft(501) }),
      loadMappings: async () => [{ catalog_part_id: ACTOR_ID, normalized_part_number: "QAQR001", product_external_id: "99", uom_code: "ea" }],
      stageReceipt: async () => { staged = true; },
      inspectProvider: async (_client, { lines }) => {
        providerInspected = true;
        return {
          pickingTypeId: 245,
          sourceLocationId: 4,
          destinationLocationId: 471,
          products: lines.map((line) => ({ ...line, productExternalId: 99, uomExternalId: 1 })),
        };
      },
      qrOptions: { signingKey: SIGNING_KEY },
    }),
    (error) => error.code === "INVENTORY_RECEIPT_UNIT_LIMIT",
  );
  assert.equal(staged, false);
  assert.equal(providerInspected, false);
});

test.skip("legacy: QR configuration is preflighted before receipt staging or provider activity", async () => {
  let staged = false;
  let providerInspected = false;
  let reconciled = false;
  await assert.rejects(
    receiveReviewedInvoice(RUN_ID, { idempotencyKey: "receive-test-config" }, context(), {
      loadInvoice: async () => ({ id: RUN_ID, company_id: COMPANY_ID, location_id: LOCATION_ID, status: "reviewed", reviewed_draft: draft() }),
      stageReceipt: async () => { staged = true; },
      inspectProvider: async () => { providerInspected = true; },
      markReconciliation: async () => { reconciled = true; },
      qrOptions: { signingKey: "" },
    }),
    (error) => error.code === "inventory_qr_not_configured",
  );
  assert.equal(staged, false);
  assert.equal(providerInspected, false);
  assert.equal(reconciled, false);
});

test.skip("legacy: a conflicting staged receipt stops before any provider write", async () => {
  let providerInspected = false;
  let providerWritten = false;
  await assert.rejects(
    receiveReviewedInvoice(RUN_ID, { idempotencyKey: "receive-test-conflict" }, context(), {
      loadInvoice: async () => ({ id: RUN_ID, company_id: COMPANY_ID, location_id: LOCATION_ID, status: "reviewed", reviewed_draft: draft() }),
      loadMappings: async () => [{ catalog_part_id: ACTOR_ID, normalized_part_number: "QAQR001", product_external_id: "99", uom_code: "ea" }],
      loadLocations: async () => ["471"],
      readConfiguration: async () => ({ database: "qa" }),
      createClient: () => ({}),
      stageReceipt: async () => ({ conflict: true }),
      inspectProvider: async (_client, { lines }) => {
        providerInspected = true;
        return {
          pickingTypeId: 245,
          sourceLocationId: 4,
          destinationLocationId: 471,
          products: lines.map((line) => ({ ...line, productExternalId: 99, uomExternalId: 1 })),
        };
      },
      ensureProviderReceipt: async () => { providerWritten = true; },
      qrOptions: { signingKey: SIGNING_KEY },
    }),
    (error) => error.code === "INVENTORY_RECEIPT_REPLAY_CONFLICT" && error.statusCode === 409,
  );
  assert.equal(providerInspected, true);
  assert.equal(providerWritten, false);
});

test("legacy Odoo receipt ingress returns one stable retirement response without dependencies", async () => {
  await assert.rejects(
    receiveReviewedInvoice(RUN_ID, { idempotencyKey: "retired" }, context(), {
      loadInvoice: async () => assert.fail("retired ingress must not load or mutate receipt state"),
      ensureProviderReceipt: async () => assert.fail("retired ingress must not call Odoo"),
    }),
    (error) => error.code === "LEGACY_ODOO_RECEIPT_INGRESS_RETIRED"
      && error.statusCode === 410
      && error.message === "This Odoo receipt path is retired. Confirm delivery through the local inventory receipt workflow.",
  );
});

test("scan resolution requires a valid token and location scope", async () => {
  const unitId = "00000000-0000-4000-8000-000000000099";
  const token = createInventoryQrToken(unitId, { signingKey: SIGNING_KEY });
  let receivedScope;
  const unit = { id: unitId, serialNumber: "WG-QA", status: "in_stock" };
  const result = await resolveInventoryCode({ code: `https://workorders.example.test/?inventoryScan=${token}` }, context("mechanic"), {
    qrOptions: { signingKey: SIGNING_KEY },
    getUnit: async (scope) => { receivedScope = scope; return unit; },
  });
  assert.deepEqual(result.unit, unit);
  assert.deepEqual(receivedScope.companyIds, [COMPANY_ID]);
  assert.deepEqual(receivedScope.locationIds, [LOCATION_ID]);
  assert.equal(receivedScope.isAdmin, false);
  await assert.rejects(
    resolveInventoryCode({ code: `${token.slice(0, -1)}A` }, context(), { qrOptions: { signingKey: SIGNING_KEY } }),
    (error) => error.code === "inventory_not_found" && error.statusCode === 404,
  );
});
