import assert from "node:assert/strict";
import test from "node:test";
import { effectiveInventoryScope } from "./inventory-effective-scope.js";
import {
  createSerializedUnitsForPart,
  readPartLocationSerialization,
  readSerializedInventoryUnit,
} from "./inventory-part-serialization.service.js";

const COMPANY_ID = "00000000-0000-4000-8000-000000000301";
const ASSIGNED_LOCATION_ID = "00000000-0000-4000-8000-000000000302";
const OTHER_LOCATION_ID = "00000000-0000-4000-8000-000000000303";
const PART_ID = "00000000-0000-4000-8000-000000000304";
const ACTOR_ID = "00000000-0000-4000-8000-000000000305";
const SIGNING_KEY = Buffer.alloc(32, 12).toString("base64");
const loadLocation = async (id) => ({ id, company_id: COMPANY_ID });
const resolveResourceScope = (requestContext, _type, _id, options) => effectiveInventoryScope(requestContext, { companyId: COMPANY_ID, locationId: options.companyWideRoles?.includes(requestContext.actor.role) ? null : ASSIGNED_LOCATION_ID, ...options });

function context(role = "office") {
  return {
    actor: { id: ACTOR_ID, role },
    companyIds: new Set([COMPANY_ID]),
    locationIds: new Set([ASSIGNED_LOCATION_ID]),
  };
}

test("Office can read every location in its company but can create only at an assigned location", async () => {
  let readInput;
  const result = await readPartLocationSerialization(PART_ID, OTHER_LOCATION_ID, context(), {
    loadLocation,
    read: async (input) => {
      readInput = input;
      return { part: { catalogPartId: PART_ID }, location: { locationId: OTHER_LOCATION_ID }, units: [] };
    },
  });
  assert.deepEqual(readInput.companyIds, [COMPANY_ID]);
  assert.equal("locationIds" in readInput, false);
  assert.equal(result.canCreateAtLocation, false);
  assert.equal(result.canReceiveStock, false);
});

test("aggregate intake metadata exposes canonical UOM only at an assigned writable location", async () => {
  const result = await readPartLocationSerialization(PART_ID, ASSIGNED_LOCATION_ID, context(), {
    loadLocation,
    read: async () => ({ part: { catalogPartId: PART_ID, uomCode: "case", canonicalUomCode: "ea", trackingMode: "quantity" }, location: {}, units: [] }),
  });
  assert.equal(result.part.canonicalUomCode, "ea");
  assert.equal(result.canReceiveStock, true);
  const mechanicResult = await readPartLocationSerialization(PART_ID, ASSIGNED_LOCATION_ID, context("mechanic"), {
    loadLocation,
    read: async () => ({ part: { catalogPartId: PART_ID, uomCode: "ea", trackingMode: "quantity" }, location: {}, units: [] }),
  });
  assert.equal(mechanicResult.canReceiveStock, false);
});

test("serialized intake forwards physical confirmation and assigned-location scope", async () => {
  let createInput;
  const result = await createSerializedUnitsForPart(PART_ID, ASSIGNED_LOCATION_ID, {
    quantity: 2,
    confirmation: "physically_present_at_location",
    idempotencyKey: "serialize-two-present-parts",
  }, context(), {
    loadLocation,
    qrOptions: { signingKey: SIGNING_KEY },
    create: async (input) => {
      createInput = input;
      return { kind: "created", replayed: false, quantity: 2, batch: { id: "batch-1" } };
    },
  });
  assert.equal(result.quantity, 2);
  assert.deepEqual(createInput.companyIds, [COMPANY_ID]);
  assert.deepEqual(createInput.locationIds, [ASSIGNED_LOCATION_ID]);
  assert.equal(createInput.isAdmin, false);
  assert.equal(createInput.actorId, ACTOR_ID);
});

test("workorder-scoped serialized intake forwards workorder identity to the transactional repository", async () => {
  const workorderId = "00000000-0000-4000-8000-000000000399";
  let createInput;
  await createSerializedUnitsForPart(PART_ID, ASSIGNED_LOCATION_ID, {
    quantity: 1,
    confirmation: "physically_present_at_location",
    idempotencyKey: "workorder-locked-intake",
  }, context(), {
    loadLocation,
    workorderId,
    qrOptions: { signingKey: SIGNING_KEY },
    create: async (input) => { createInput = input; return { kind: "created", batch: {}, units: [] }; },
  });
  assert.equal(createInput.workorderId, workorderId);
});

test("Office reads canonical serialized-child history across its company", async () => {
  let readInput;
  const result = await readSerializedInventoryUnit(PART_ID, context(), {
    resolveResourceScope,
    readUnit: async (input) => {
      readInput = input;
      return { id: PART_ID, serialNumber: "WG-S-TEST-1", events: [] };
    },
  });
  assert.equal(result.serialNumber, "WG-S-TEST-1");
  assert.deepEqual(readInput.companyIds, [COMPANY_ID]);
  assert.deepEqual(readInput.locationIds, [ASSIGNED_LOCATION_ID]);
  assert.equal(readInput.isAdmin, true);
});

test("Office unit detail adds tenant-scoped invoice identity without changing the scan projection", async () => {
  let invoiceInput;
  const result = await readSerializedInventoryUnit(PART_ID, context(), {
    resolveResourceScope,
    readUnit: async () => ({
      id: PART_ID,
      serialNumber: "WG-L-TEST-1",
      source: { type: "invoice", id: "00000000-0000-4000-8000-000000000306" },
      events: [],
    }),
    readInvoiceSource: async (input) => {
      invoiceInput = input;
      return {
        id: "00000000-0000-4000-8000-000000000306",
        fileName: "qa-invoice.pdf",
        vendorName: "QA Vendor",
        invoiceNumber: "QA-INV-306",
      };
    },
  });
  assert.deepEqual(result.source, {
    type: "invoice",
    id: "00000000-0000-4000-8000-000000000306",
    fileName: "qa-invoice.pdf",
    vendorName: "QA Vendor",
    invoiceNumber: "QA-INV-306",
  });
  assert.deepEqual(invoiceInput, {
    unitId: PART_ID,
    companyIds: [COMPANY_ID],
    locationIds: [ASSIGNED_LOCATION_ID],
    isAdmin: true,
  });
});

test("missing serialized-child detail stays hidden behind a stable not-found error", async () => {
  await assert.rejects(
    readSerializedInventoryUnit(PART_ID, context(), { resolveResourceScope, readUnit: async () => null }),
    (error) => error.code === "inventory_not_found" && error.statusCode === 404,
  );
});

test("repository replay and unit errors map to stable public errors", async () => {
  const input = {
    quantity: 1,
    confirmation: "physically_present_at_location",
    idempotencyKey: "serialize-one-present-part",
  };
  await assert.rejects(
    createSerializedUnitsForPart(PART_ID, ASSIGNED_LOCATION_ID, input, context(), {
      loadLocation,
      qrOptions: { signingKey: SIGNING_KEY },
      create: async () => ({ kind: "replay_conflict" }),
    }),
    (error) => error.code === "INVENTORY_SERIALIZATION_REPLAY_CONFLICT" && error.statusCode === 409,
  );
  await assert.rejects(
    createSerializedUnitsForPart(PART_ID, ASSIGNED_LOCATION_ID, input, context(), {
      loadLocation,
      qrOptions: { signingKey: SIGNING_KEY },
      create: async () => ({ kind: "unsupported_unit" }),
    }),
    (error) => error.code === "INVENTORY_SERIALIZATION_UNIT_UNSUPPORTED" && error.statusCode === 422,
  );
});

test("quantity policy cannot create serialized identities", async () => {
  await assert.rejects(
    createSerializedUnitsForPart(PART_ID, ASSIGNED_LOCATION_ID, {
      quantity: 1,
      confirmation: "physically_present_at_location",
      idempotencyKey: "quantity-policy-no-serial",
    }, context(), {
      loadLocation,
      qrOptions: { signingKey: SIGNING_KEY },
      create: async () => ({ kind: "tracking_policy" }),
    }),
    (error) => error.code === "INVENTORY_SERIALIZATION_TRACKING_POLICY" && error.statusCode === 422,
  );
});

test("primary Admin cannot create physical units in a Mechanic company", async () => {
  const adminCompanyId = "11111111-1111-4111-8111-111111111111";
  const mixed = {
    ...context("admin"),
    companyIds: new Set([adminCompanyId, COMPANY_ID]),
    companyRoles: new Map([[adminCompanyId, "admin"], [COMPANY_ID, "mechanic"]]),
  };
  const input = { quantity: 1, confirmation: "physically_present_at_location", idempotencyKey: "mixed-role-serial-1" };
  let wrote = false;
  await assert.rejects(createSerializedUnitsForPart(PART_ID, ASSIGNED_LOCATION_ID, input, mixed, {
    loadLocation,
    qrOptions: { signingKey: SIGNING_KEY },
    create: async () => { wrote = true; return { kind: "created" }; },
  }), (error) => error.statusCode === 403);
  assert.equal(wrote, false);
  const officeInTarget = { ...mixed, companyRoles: new Map([[adminCompanyId, "admin"], [COMPANY_ID, "office"]]) };
  let scope;
  await createSerializedUnitsForPart(PART_ID, ASSIGNED_LOCATION_ID, input, officeInTarget, {
    loadLocation,
    qrOptions: { signingKey: SIGNING_KEY },
    create: async (value) => (scope = value, { kind: "created", quantity: 1 }),
  });
  assert.deepEqual(scope.companyIds, [COMPANY_ID]);
  assert.equal(scope.isAdmin, false);
});
