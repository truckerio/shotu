import assert from "node:assert/strict";
import test from "node:test";
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
    read: async (input) => {
      readInput = input;
      return { part: { catalogPartId: PART_ID }, location: { locationId: OTHER_LOCATION_ID }, units: [] };
    },
  });
  assert.deepEqual(readInput.companyIds, [COMPANY_ID]);
  assert.equal("locationIds" in readInput, false);
  assert.equal(result.canCreateAtLocation, false);
});

test("serialized intake forwards physical confirmation and assigned-location scope", async () => {
  let createInput;
  const result = await createSerializedUnitsForPart(PART_ID, ASSIGNED_LOCATION_ID, {
    quantity: 2,
    confirmation: "physically_present_at_location",
    idempotencyKey: "serialize-two-present-parts",
  }, context(), {
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
    workorderId,
    qrOptions: { signingKey: SIGNING_KEY },
    create: async (input) => { createInput = input; return { kind: "created", batch: {}, units: [] }; },
  });
  assert.equal(createInput.workorderId, workorderId);
});

test("Office reads canonical serialized-child history across its company", async () => {
  let readInput;
  const result = await readSerializedInventoryUnit(PART_ID, context(), {
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
    readSerializedInventoryUnit(PART_ID, context(), { readUnit: async () => null }),
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
      qrOptions: { signingKey: SIGNING_KEY },
      create: async () => ({ kind: "replay_conflict" }),
    }),
    (error) => error.code === "INVENTORY_SERIALIZATION_REPLAY_CONFLICT" && error.statusCode === 409,
  );
  await assert.rejects(
    createSerializedUnitsForPart(PART_ID, ASSIGNED_LOCATION_ID, input, context(), {
      qrOptions: { signingKey: SIGNING_KEY },
      create: async () => ({ kind: "unsupported_unit" }),
    }),
    (error) => error.code === "INVENTORY_SERIALIZATION_UNIT_UNSUPPORTED" && error.statusCode === 422,
  );
});
