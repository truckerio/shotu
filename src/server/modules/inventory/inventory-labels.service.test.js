import assert from "node:assert/strict";
import test from "node:test";
import {
  readInventoryLabelBatchItems,
  renderInventoryLabelBatchPrint,
  renderInventoryUnitLabel,
  renderPartLocationLabels,
} from "./inventory-labels.service.js";

const COMPANY_ID = "00000000-0000-4000-8000-000000000201";
const LOCATION_ID = "00000000-0000-4000-8000-000000000202";
const BATCH_ID = "00000000-0000-4000-8000-000000000203";
const UNIT_ID = "00000000-0000-4000-8000-000000000204";
const SIGNING_KEY = Buffer.alloc(32, 31).toString("base64");

function context(locationIds = [LOCATION_ID]) {
  return {
    actor: { role: "office" },
    companyIds: new Set([COMPANY_ID]),
    locationIds: new Set(locationIds),
  };
}

function batch() {
  return {
    id: BATCH_ID,
    receiptId: "receipt-1",
    locationId: LOCATION_ID,
    locationName: "Chino Yard",
    status: "ready",
    itemCount: 1,
    templateVersion: "receipt-label-v1",
  };
}

function item() {
  return {
    id: "item-1",
    unitId: UNIT_ID,
    ordinal: 1,
    partNumber: "FILTER-1",
    description: "Oil <filter>",
    serialNumber: "WG-L-TEST-1-1",
    locationName: "Chino Yard",
    qrFormatVersion: 1,
  };
}

test("label manifest is bounded, paginated, and scoped", async () => {
  let received;
  const result = await readInventoryLabelBatchItems(BATCH_ID, new URLSearchParams({ after: "0", limit: "1" }), context(), {
    getBatch: async (scope) => { received = scope; return batch(); },
    listItems: async () => [item()],
  });
  assert.deepEqual(received.companyIds, [COMPANY_ID]);
  assert.deepEqual(received.locationIds, [LOCATION_ID]);
  assert.equal(result.items[0].unitId, UNIT_ID);
  assert.equal(result.nextCursor, null);
});

test("print output preserves immutable identity and escapes label snapshots", async () => {
  const html = await renderInventoryLabelBatchPrint(BATCH_ID, context(), {
    getBatch: async () => batch(),
    listAllItems: async () => [item()],
    qrOptions: { signingKey: SIGNING_KEY, origin: "https://inventory.example.test" },
  });
  assert.match(html, /FILTER-1/);
  assert.match(html, /WG-L-TEST-1-1/);
  assert.match(html, /Oil &lt;filter&gt;/);
  assert.match(html, /<svg/);
  assert.doesNotMatch(html, /Oil <filter>/);
});

test("cross-location label batch is hidden", async () => {
  await assert.rejects(
    readInventoryLabelBatchItems(BATCH_ID, new URLSearchParams(), context([]), {
      getBatch: async () => null,
    }),
    (error) => error.code === "inventory_not_found" && error.statusCode === 404,
  );
});

test("Office can print serialized unit and part-location labels across its company", async () => {
  const unassignedContext = context([]);
  const unitHtml = await renderInventoryUnitLabel(UNIT_ID, unassignedContext, {
    getUnit: async (scope) => {
      assert.equal(scope.isAdmin, true);
      assert.deepEqual(scope.companyIds, [COMPANY_ID]);
      return {
        id: UNIT_ID,
        status: "in_stock",
        partNumber: "FILTER-1",
        description: "Oil filter",
        serialNumber: "WG-S-1",
        locationName: "Remote Yard",
      };
    },
    qrOptions: { signingKey: SIGNING_KEY, origin: "https://inventory.example.test" },
  });
  assert.match(unitHtml, /WG-S-1/);

  const locationHtml = await renderPartLocationLabels(UNIT_ID, LOCATION_ID, unassignedContext, {
    readPart: async (scope) => {
      assert.deepEqual(scope.companyIds, [COMPANY_ID]);
      return {
        part: { partNumber: "FILTER-1", description: "Oil filter" },
        location: { locationName: "Remote Yard" },
        units: [{ id: UNIT_ID, serialNumber: "WG-S-1", status: "in_stock" }],
      };
    },
    qrOptions: { signingKey: SIGNING_KEY, origin: "https://inventory.example.test" },
  });
  assert.match(locationHtml, /1 serialized unit/);
  assert.match(locationHtml, /Remote Yard/);
});
