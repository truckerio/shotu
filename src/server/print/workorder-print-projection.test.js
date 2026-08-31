import assert from "node:assert/strict";
import test from "node:test";

import {
  listOfficialConsumedAggregateParts,
  listOfficialInstalledSerializedParts,
  mergeOfficialWorkorderParts,
} from "./workorder-print-projection.js";

test("official part merge retains exact serials and removes matching manual projections", () => {
  const result = mergeOfficialWorkorderParts([
    { partNo: "FILTER-1", qty: "2", uomCode: "ea", repairOrder: "Replace filters" },
    { partNo: "OIL", qty: "2.5", uomCode: "gal", repairOrder: "Refill" },
  ], [
    { usageId: "usage-1", partNumber: "FILTER-1", serialNumber: "SER-1", uomCode: "ea", repairOrder: "Replace filters" },
    { usageId: "usage-2", partNumber: "FILTER-1", serialNumber: "SER-2", uomCode: "ea", repairOrder: "Replace filters" },
  ]);

  assert.deepEqual(result, [
    { usageId: "usage-1", catalogPartId: undefined, partNo: "FILTER-1", serialNumber: "SER-1", qty: "1", uomCode: "ea", repairOrder: "Replace filters" },
    { usageId: "usage-2", catalogPartId: undefined, partNo: "FILTER-1", serialNumber: "SER-2", qty: "1", uomCode: "ea", repairOrder: "Replace filters" },
    { partNo: "OIL", qty: "2.5", uomCode: "gal", repairOrder: "Refill" },
  ]);
});

test("official merge includes consumed measured evidence and suppresses matching legacy manual rows", () => {
  const result = mergeOfficialWorkorderParts([
    { partNo: "COOLANT", qty: "2.75", uomCode: "gal", repairOrder: "Refill cooling system" },
    { partNo: "SHOP-RAG", qty: "3", uomCode: "ea", repairOrder: "Clean area" },
  ], [], [{
    aggregateUsageId: "aggregate-1",
    evidenceId: "evidence-1",
    catalogPartId: "part-1",
    partNumber: "COOLANT",
    effectiveQuantity: 2.75,
    uomCode: "gal",
    repairOrder: "Refill cooling system",
  }]);

  assert.deepEqual(result, [{
    aggregateUsageId: "aggregate-1",
    evidenceId: "evidence-1",
    catalogPartId: "part-1",
    partNo: "COOLANT",
    qty: "2.75",
    uomCode: "gal",
    repairOrder: "Refill cooling system",
  }, {
    partNo: "SHOP-RAG", qty: "3", uomCode: "ea", repairOrder: "Clean area",
  }]);
});

test("official aggregate query includes only consumed scoped usages with adjusted effective quantity", async () => {
  let captured;
  const rows = await listOfficialConsumedAggregateParts({
    workorderId: "wo-1",
    companyId: "company-1",
    locationId: "location-1",
  }, {
    query: async (sql, values) => {
      captured = { sql, values };
      return { rows: [{
        inventory_kind: "aggregate",
        usage_id: "aggregate-1",
        evidence_id: "evidence-1",
        catalog_part_id: "part-1",
        part_number: "COOLANT",
        effective_quantity: "3.125",
        uom_code: "gal",
        repair_order: "Refill",
      }] };
    },
  });

  assert.match(captured.sql, /usage\.status = 'consumed'/);
  assert.match(captured.sql, /usage\.quantity \+ usage\.adjustment_total as effective_quantity/);
  assert.doesNotMatch(captured.sql, /installed_pending_approval|reserved|released|reversed/);
  assert.match(captured.sql, /usage\.workorder_id = \$1[\s\S]*usage\.company_id = \$2[\s\S]*usage\.location_id = \$3/);
  assert.deepEqual(captured.values, ["wo-1", "company-1", "location-1", 2000]);
  assert.deepEqual(rows[0], {
    aggregateUsageId: "aggregate-1",
    evidenceId: "evidence-1",
    catalogPartId: "part-1",
    partNumber: "COOLANT",
    partNo: "COOLANT",
    effectiveQuantity: 3.125,
    qty: "3.125",
    uomCode: "gal",
    repairOrder: "Refill",
  });
});

test("official serialized query is tenant/location scoped and excludes pending approval", async () => {
  let captured;
  const rows = await listOfficialInstalledSerializedParts({
    workorderId: "wo-1",
    companyId: "company-1",
    locationId: "location-1",
  }, {
    query: async (sql, values) => {
      captured = { sql, values };
      return { rows: [{
        inventory_kind: "serialized",
        usage_id: "usage-1",
        catalog_part_id: "part-1",
        part_number: "FILTER-1",
        serial_number: "SER-1",
        uom_code: "ea",
        repair_order: "Replace",
      }] };
    },
  });

  assert.match(captured.sql, /usage\.status = 'installed'/);
  assert.doesNotMatch(captured.sql, /installed_pending_approval/);
  assert.deepEqual(captured.values, ["wo-1", "company-1", "location-1", 2000]);
  assert.equal(rows[0].serialNumber, "SER-1");
  assert.equal(rows[0].partNumber, "FILTER-1");
});
