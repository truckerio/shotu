import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { handleInventoryApi, inventoryRouteInternals } from "./inventory.routes.js";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const LOCATION_ID = "00000000-0000-4000-8000-000000000002";
const ACTOR_ID = "00000000-0000-4000-8000-000000000003";
const RUN_ID = "00000000-0000-4000-8000-000000000004";
const BATCH_ID = "00000000-0000-4000-8000-000000000007";
const COUNT_ID = "00000000-0000-4000-8000-000000000008";
const COUNT_LINE_ID = "00000000-0000-4000-8000-000000000009";
const AUTHORITY_EXCEPTION_ID = "00000000-0000-4000-8000-000000000010";

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

test.skip("legacy: receive route crosses the real handler boundary and returns a confirmed receipt", async () => {
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

test("retired receive route exposes the stable 410 inventory error", async () => {
  const response = {};
  const handled = await handleInventoryApi(
      { method: "POST" },
      response,
      new URL(`http://localhost/api/office/invoice-extractions/${RUN_ID}/receive`),
      helpers({ idempotencyKey: "retired-route" }),
      { loadInvoice: async () => assert.fail("retired route must not read receipt state") },
  );
  assert.equal(handled, true);
  assert.equal(response.status, 410);
  assert.equal(response.payload.code, "LEGACY_ODOO_RECEIPT_INGRESS_RETIRED");
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

test("Admin authority queue routes bounded reads and no-stock-change acknowledgement", async () => {
  const denied = {};
  await handleInventoryApi(
    { method: "GET" }, denied,
    new URL("http://localhost/api/office/inventory/authority-exceptions"),
    helpers(null),
    { listAuthorityExceptions: async () => assert.fail("Office request reached repository") },
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.payload.code, "INVENTORY_AUTHORITY_ADMIN_REQUIRED");

  const admin = { ...context(), actor: { id: ACTOR_ID, role: "admin" } };
  const listed = {};
  await handleInventoryApi(
    { method: "GET" }, listed,
    new URL("http://localhost/api/office/inventory/authority-exceptions?page=1&limit=25"),
    helpers(null, admin),
    { listAuthorityExceptions: async () => ({ items: [], total: 0 }) },
  );
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.payload, { items: [], total: 0, page: 1, limit: 25 });

  const resolved = {};
  await handleInventoryApi(
    { method: "POST", requestId: "authority-route" }, resolved,
    new URL(`http://localhost/api/office/inventory/authority-exceptions/${AUTHORITY_EXCEPTION_ID}/resolve`),
    helpers({ action: "acknowledge", reason: "Evidence reviewed", idempotencyKey: "authority-route-1" }, admin),
    { acknowledgeAuthorityException: async () => ({ kind: "resolved", exceptionId: AUTHORITY_EXCEPTION_ID, outcome: "resolved_without_stock_mutation" }) },
  );
  assert.equal(resolved.status, 200);
  assert.equal(resolved.payload.outcome, "resolved_without_stock_mutation");
});

test("physical confirmation route returns an application-owned receipt without an Odoo call", async () => {
  const response = {};
  let posted = false;
  await handleInventoryApi(
    { method: "POST" },
    response,
    new URL(`http://localhost/api/office/invoice-extractions/${RUN_ID}/confirm-receipt`),
    helpers({ idempotencyKey: "route-local-post-1", expectedVersion: 2, confirmation: "all_received_undamaged" }),
    {
      loadInvoice: async () => ({
        id: RUN_ID,
        company_id: COMPANY_ID,
        location_id: LOCATION_ID,
        status: "reviewed",
        version: 2,
        reviewed_draft: {
          documentType: { value: "invoice", confidence: 100, evidence: "test" },
          vendorName: { value: "QA", confidence: 100, evidence: "test" },
          vendorAccount: { value: "", confidence: 100, evidence: "test" },
          invoiceNumber: { value: "QA-LOCAL-1", confidence: 100, evidence: "test" },
          invoiceDate: { value: "2026-08-25", confidence: 100, evidence: "test" },
          purchaseOrderNumber: { value: "", confidence: 100, evidence: "test" },
          currency: { value: "USD", confidence: 100, evidence: "test" },
          subtotal: { value: 10, confidence: 100, evidence: "test" },
          tax: { value: 0, confidence: 100, evidence: "test" },
          shipping: { value: 0, confidence: 100, evidence: "test" },
          total: { value: 10, confidence: 100, evidence: "test" },
          lines: [{
            id: "line-1",
            partNumber: { value: "LOCAL-1", confidence: 100, evidence: "test" },
            description: { value: "Local part", confidence: 100, evidence: "test" },
            quantity: { value: 1, confidence: 100, evidence: "test" },
            unitOfMeasure: { value: "ea", confidence: 100, evidence: "test" },
            unitPrice: { value: 10, confidence: 100, evidence: "test" },
            lineTotal: { value: 10, confidence: 100, evidence: "test" },
          }],
          warnings: [],
        },
      }),
      postReceipt: async (input) => {
        posted = true;
        return { kind: "posted", receipt: { id: input.receiptId, status: "posted", lineCount: 1, units: [], labelBatch: null } };
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.payload.receipt.status, "posted");
  assert.equal(response.payload.replayed, false);
  assert.equal(posted, true);
});

test("physical confirmation route rejects an absent delivery attestation", async () => {
  const response = {};
  await handleInventoryApi(
    { method: "POST" },
    response,
    new URL(`http://localhost/api/office/invoice-extractions/${RUN_ID}/confirm-receipt`),
    helpers({ idempotencyKey: "route-no-attestation", expectedVersion: 2 }),
    {},
  );
  assert.equal(response.status, 400);
  assert.equal(response.payload.code, "validation_error");
});

test("durable label manifest route returns a bounded immutable page", async () => {
  const response = {};
  await handleInventoryApi(
    { method: "GET" },
    response,
    new URL(`http://localhost/api/office/inventory/label-batches/${BATCH_ID}/items?limit=1`),
    helpers(null),
    {
      getBatch: async () => ({ id: BATCH_ID, status: "ready", itemCount: 1, locationId: LOCATION_ID }),
      listItems: async () => [{ id: "label-1", unitId: "unit-1", ordinal: 1, serialNumber: "WG-L-1" }],
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.payload.batch.id, BATCH_ID);
  assert.equal(response.payload.items[0].ordinal, 1);
  assert.equal(response.payload.nextCursor, null);
});

test("bounded stock list route uses authenticated scope", async () => {
  const response = {};
  const inputs = [];
  await handleInventoryApi(
    { method: "GET" },
    response,
    new URL("http://localhost/api/office/inventory/stock?q=filter&limit=25&sort=locations_desc"),
    helpers(null),
    { listStock: async (nextInput) => { inputs.push(nextInput); return []; } },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload.items, []);
  assert.deepEqual(inputs[0].companyIds, [COMPANY_ID]);
  assert.deepEqual(inputs[0].locationIds, [LOCATION_ID]);
  assert.equal(inputs[0].queryText, "filter");
  assert.equal(inputs[0].limit, 25);
  assert.equal(inputs[0].sort, "locations_desc");
});

test("part-location routes read company-wide details and create auditable serialized children", async () => {
  const readResponse = {};
  let readInput;
  await handleInventoryApi(
    { method: "GET" },
    readResponse,
    new URL(`http://localhost/api/office/inventory/parts/${RUN_ID}/locations/${LOCATION_ID}/units`),
    helpers(null),
    {
      read: async (input) => {
        readInput = input;
        return { part: { catalogPartId: RUN_ID }, location: { locationId: LOCATION_ID }, units: [] };
      },
    },
  );
  assert.equal(readResponse.status, 200);
  assert.deepEqual(readInput.companyIds, [COMPANY_ID]);

  const createResponse = {};
  const events = [];
  await handleInventoryApi(
    { method: "POST", requestId: "serialize-route-1" },
    createResponse,
    new URL(`http://localhost/api/office/inventory/parts/${RUN_ID}/locations/${LOCATION_ID}/units`),
    {
      ...helpers({
        quantity: 2,
        confirmation: "physically_present_at_location",
        idempotencyKey: "serialize-route-two",
      }),
      emitAdministrativeAuditEvent: async (event) => { events.push(event); },
    },
    {
      qrOptions: { signingKey: Buffer.alloc(32, 4).toString("base64") },
      create: async () => ({ kind: "created", quantity: 2, replayed: false, batch: { id: BATCH_ID } }),
    },
  );
  assert.equal(createResponse.status, 201);
  assert.equal(createResponse.payload.quantity, 2);
  assert.deepEqual(events, [{
    type: "inventory_serialized_units_created",
    requestId: "serialize-route-1",
    actorId: ACTOR_ID,
    catalogPartId: RUN_ID,
    locationId: LOCATION_ID,
    quantity: 2,
    replayed: false,
  }]);
});

test("inventory master route accepts only master-match purpose and preserves authorized scope", async () => {
  const response = {};
  let locationScope;
  let catalogSearch;
  const handled = await handleInventoryApi(
    { method: "GET" },
    response,
    new URL(`http://localhost/api/office/inventory/catalog?q=filter&locationId=${LOCATION_ID}&purpose=master_match`),
    helpers(null),
    {
      findLocation: async (scope) => {
        locationScope = scope;
        return { id: LOCATION_ID, company_id: COMPANY_ID };
      },
      searchCatalog: async (companyId, input) => {
        catalogSearch = { companyId, input };
        return { catalogAvailable: true, items: [{ id: "catalog-part-1" }] };
      },
    },
  );

  assert.equal(handled, true);
  assert.equal(response.status, 200);
  assert.deepEqual(locationScope.companyIds, [COMPANY_ID]);
  assert.deepEqual(locationScope.locationIds, [LOCATION_ID]);
  assert.deepEqual(catalogSearch, {
    companyId: COMPANY_ID,
    input: { text: "filter", locationId: LOCATION_ID, limit: 8, purpose: "master_match" },
  });

  const invalidResponse = {};
  let invalidSearched = false;
  await handleInventoryApi(
    { method: "GET" },
    invalidResponse,
    new URL(`http://localhost/api/office/inventory/catalog?q=filter&locationId=${LOCATION_ID}&purpose=request`),
    helpers(null),
    {
      findLocation: async () => {
        invalidSearched = true;
        return { id: LOCATION_ID, company_id: COMPANY_ID };
      },
    },
  );
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidResponse.payload.code, "validation_error");
  assert.equal(invalidSearched, false);
});

test("serialized-child detail route returns the canonical timeline projection", async () => {
  const response = {};
  let readInput;
  await handleInventoryApi(
    { method: "GET" },
    response,
    new URL(`http://localhost/api/office/inventory/units/${RUN_ID}`),
    helpers(null),
    {
      readUnit: async (input) => {
        readInput = input;
        return {
          id: RUN_ID,
          serialNumber: "WG-S-ROUTE-1",
          events: [{ type: "receipt_recorded", at: "2026-08-28T00:00:00.000Z" }],
        };
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.payload.serialNumber, "WG-S-ROUTE-1");
  assert.deepEqual(readInput.companyIds, [COMPANY_ID]);
  assert.equal(readInput.isAdmin, true);
});

test("opening-count upload route forwards authenticated scope and preserves a reviewable draft", async () => {
  const response = {};
  let input;
  const events = [];
  const bytes = Buffer.from("test");
  await handleInventoryApi(
    { method: "POST" },
    response,
    new URL("http://localhost/api/office/inventory/count-imports"),
    {
      ...helpers({
      locationId: LOCATION_ID,
      sourceFileName: "opening-count.xlsx",
      sourceContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sourceSizeBytes: bytes.length,
      sourceFileBase64: bytes.toString("base64"),
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      rows: [{ sourceRow: 4, partNumber: "PART-1", partName: "Part", quantity: "3" }],
      }),
      emitAdministrativeAuditEvent: async (event) => { events.push(event); },
    },
    {
      parseWorkbook: async () => [{ sourceRow: 4, partNumber: "PART-1", partName: "Part", quantity: "3" }],
      findLocation: async () => ({ id: LOCATION_ID, company_id: COMPANY_ID }),
      encryptFile: () => ({ ciphertext: bytes, iv: Buffer.alloc(12), authTag: Buffer.alloc(16), keyVersion: "test-v1" }),
      createImport: async (nextInput) => {
        input = nextInput;
        return { kind: "created", import: { id: COUNT_ID, locationId: LOCATION_ID, status: "draft", readyCount: 1, appliedCount: 0 } };
      },
    },
  );
  assert.equal(response.status, 201);
  assert.equal(response.payload.import.status, "draft");
  assert.equal(response.payload.import.appliedCount, 0);
  assert.deepEqual(input.companyIds, [COMPANY_ID]);
  assert.deepEqual(input.locationIds, [LOCATION_ID]);
  assert.equal(input.actorId, ACTOR_ID);
  assert.equal(input.rows[0].quantity, 3);
  assert.deepEqual(events, [{
    type: "inventory_count_upload",
    requestId: null,
    actorId: ACTOR_ID,
    importId: COUNT_ID,
    locationId: LOCATION_ID,
    replayed: false,
  }]);
});

test("opening-count apply route requires physical attestation and calls the scoped transaction", async () => {
  const response = {};
  let input;
  const events = [];
  await handleInventoryApi(
    { method: "POST" },
    response,
    new URL(`http://localhost/api/office/inventory/count-imports/${COUNT_ID}/apply`),
    {
      ...helpers({ expectedVersion: 2, confirmation: "physically_counted" }, {
        ...context(),
        actor: { id: ACTOR_ID, role: "admin" },
      }),
      emitAdministrativeAuditEvent: async (event) => { events.push(event); },
    },
    {
      applyImport: async (nextInput) => {
        input = nextInput;
        return { kind: "applied", import: { id: COUNT_ID, locationId: LOCATION_ID, status: "applied", appliedCount: 1 } };
      },
      qrOptions: { signingKey: Buffer.alloc(32, 4).toString("base64"), origin: "https://example.test" },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.payload.import.status, "applied");
  assert.deepEqual(input.companyIds, [COMPANY_ID]);
  assert.deepEqual(input.locationIds, [LOCATION_ID]);
  assert.equal(input.actorId, ACTOR_ID);
  assert.equal(input.expectedVersion, 2);
  assert.deepEqual(events, [{
    type: "inventory_count_apply",
    requestId: null,
    actorId: ACTOR_ID,
    importId: COUNT_ID,
    locationId: LOCATION_ID,
    replayed: false,
  }]);
});

test("opening-count line review emits structured audit after successful resolution", async () => {
  const response = {};
  const events = [];
  await handleInventoryApi(
    { method: "PATCH", requestId: "request-123" },
    response,
    new URL(`http://localhost/api/office/inventory/count-imports/${COUNT_ID}/lines/${COUNT_LINE_ID}`),
    {
      ...helpers({ action: "ignore", expectedVersion: 2 }),
      emitAdministrativeAuditEvent: async (event) => { events.push(event); },
    },
    {
      resolveLine: async () => ({
        kind: "updated",
        import: { id: COUNT_ID, locationId: LOCATION_ID, version: 3 },
      }),
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(events, [{
    type: "inventory_count_line_review",
    requestId: "request-123",
    actorId: ACTOR_ID,
    importId: COUNT_ID,
    lineId: COUNT_LINE_ID,
    locationId: LOCATION_ID,
    action: "ignore",
  }]);
});

test("opening-count apply route rejects a missing physical attestation", async () => {
  const response = {};
  await handleInventoryApi(
    { method: "POST" },
    response,
    new URL(`http://localhost/api/office/inventory/count-imports/${COUNT_ID}/apply`),
    helpers({ expectedVersion: 2 }),
    { qrOptions: { signingKey: Buffer.alloc(32, 4).toString("base64") } },
  );
  assert.equal(response.status, 400);
  assert.equal(response.payload.code, "validation_error");
});

test("inventory workbook download keeps tenant scope and emits RFC 5987 Unicode filename", async () => {
  const response = {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
  let input;
  let audited;
  await handleInventoryApi(
    { method: "GET" },
    response,
    new URL(`http://localhost/api/office/inventory/count-imports/${COUNT_ID}/file`),
    helpers(null),
    {
      getImportFile: async (nextInput) => {
        input = nextInput;
        return {
          id: COUNT_ID,
          company_id: COMPANY_ID,
          source_file_name: "count-🚚.xlsx",
          source_sha256: "a".repeat(64),
          source_content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          source_size_bytes: 4,
        };
      },
      decryptFile: () => Buffer.from("test"),
      auditDownload: async (event) => { audited = event; },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(input.companyIds, [COMPANY_ID]);
  assert.deepEqual(input.locationIds, [LOCATION_ID]);
  assert.equal(input.actorId, ACTOR_ID);
  assert.deepEqual(audited, { companyId: COMPANY_ID, importId: COUNT_ID, actorId: ACTOR_ID });
  assert.match(response.headers["content-disposition"], /filename="count-__\.xlsx"/);
  assert.match(response.headers["content-disposition"], /filename\*=UTF-8''count-%F0%9F%9A%9A\.xlsx/);
  assert.deepEqual(response.body, Buffer.from("test"));
});

test("inventory workbook download hides out-of-scope imports as 404", async () => {
  const response = {};
  await handleInventoryApi(
    { method: "GET" },
    response,
    new URL(`http://localhost/api/office/inventory/count-imports/${COUNT_ID}/file`),
    helpers(null),
    { getImportFile: async () => null },
  );
  assert.equal(response.status, 404);
  assert.equal(response.payload.code, "inventory_not_found");
});

test("download disposition strips header injection while retaining encoded Unicode", () => {
  const value = inventoryRouteInternals.inventoryDownloadDisposition("bad\r\n🚚.xlsx");
  assert.doesNotMatch(value, /[\r\n]/);
  assert.match(value, /filename\*=UTF-8''bad__%F0%9F%9A%9A\.xlsx/);
});

test("structured inventory audit sink failures are reported without replaying committed mutations", async () => {
  const failures = [];
  const emitted = await inventoryRouteInternals.emitInventoryAudit({
    emitAdministrativeAuditEvent: async () => { throw new Error("sink unavailable"); },
    logAuditFailure: (failure) => { failures.push(failure); },
  }, { type: "inventory_count_apply", requestId: "request-audit-1" });
  assert.equal(emitted, false);
  assert.deepEqual(failures, [{
    type: "inventory_audit_sink_failed",
    auditType: "inventory_count_apply",
    requestId: "request-audit-1",
    message: "sink unavailable",
  }]);
});

test("invoice history route returns server pagination inside authenticated scope", async () => {
  const response = {};
  let input;
  const handled = await handleInventoryApi(
    { method: "GET" },
    response,
    new URL("http://localhost/api/office/inventory/invoices?q=Rush&status=reviewed&page=2&limit=20"),
    helpers(null),
    {
      listHistory: async (nextInput) => {
        input = nextInput;
        return { items: [{ id: RUN_ID }], total: 21 };
      },
    },
  );
  assert.equal(handled, true);
  assert.equal(response.status, 200);
  assert.deepEqual(input.companyIds, [COMPANY_ID]);
  assert.deepEqual(input.locationIds, [LOCATION_ID]);
  assert.equal(input.isAdmin, false);
  assert.equal(input.offset, 20);
  assert.deepEqual(response.payload, { invoices: [{ id: RUN_ID }], page: 2, limit: 20, total: 21, pageCount: 2 });
});

test("part edit route returns the committed projection and emits supplemental audit", async () => {
  const response = {};
  const events = [];
  const body = { expectedVersion: 2, description: "Air valve", partNumber: "A-1", manufacturer: "Bendix", category: "Air", barcode: "123", uomCode: "ea", referenceNumbers: ["BW-1"] };
  const routeHelpers = helpers(body);
  routeHelpers.emitAdministrativeAuditEvent = async (event) => events.push(event);
  const handled = await handleInventoryApi(
    { method: "PATCH", requestId: "request-part-edit" }, response,
    new URL("http://localhost/api/office/inventory/parts/33333333-3333-4333-8333-333333333333"), routeHelpers,
    { updatePart: async (input) => {
      assert.equal(input.uomCode, "ea");
      return { kind: "updated", part: { catalogPartId: "33333333-3333-4333-8333-333333333333", version: 3 } };
    } },
  );
  assert.equal(handled, true);
  assert.equal(response.status, 200);
  assert.equal(response.payload.part.version, 3);
  assert.deepEqual(events, [{ type: "inventory_part_updated", requestId: "request-part-edit", actorId: ACTOR_ID, catalogPartId: "33333333-3333-4333-8333-333333333333", version: 3 }]);
});

test("catalog UOM trigger conflicts return an actionable retryable response", async () => {
  const response = {};
  const body = { expectedVersion: 2, description: "Air valve", partNumber: "A-1", manufacturer: "Bendix", category: "Air", barcode: "123", uomCode: "ea", referenceNumbers: [] };
  const handled = await handleInventoryApi(
    { method: "PATCH", requestId: "request-uom-conflict" }, response,
    new URL("http://localhost/api/office/inventory/parts/33333333-3333-4333-8333-333333333333"), helpers(body),
    { updatePart: async () => { throw Object.assign(new Error("database detail"), { constraint: "catalog_uom_activity_uom_mismatch" }); } },
  );
  assert.equal(handled, true);
  assert.equal(response.status, 409);
  assert.deepEqual(response.payload, {
    error: "The inventory unit changed. Refresh the part and try again.",
    code: "CATALOG_UOM_CHANGED",
    retryable: true,
  });
});
