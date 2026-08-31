import assert from "node:assert/strict";
import test from "node:test";

import { listWorkorderInstalledSerializedPartSummaries } from "../../db/repositories/inventory-unit-workorder-usage.repo.js";

test("interactive serialized summary includes pending and approved installations with repair details", async () => {
  let captured;
  const parts = await listWorkorderInstalledSerializedPartSummaries({
    workorderId: "workorder-1",
    companyId: "company-1",
    locationId: "location-1",
  }, {
    query: async (sql, values) => {
      captured = { sql, values };
      return { rows: [{
        id: "usage-1",
        catalog_part_id: "part-1",
        part_number: "013V/23044511",
        serial_number: "WG-S-7A822F3CA8424AFD-4",
        uom_code: "ea",
        description: "FUEL FILTER",
        repair_order: "Replace fuel filter",
        status: "installed_pending_approval",
      }] };
    },
  });

  assert.match(captured.sql, /usage\.status in \('installed_pending_approval', 'installed'\)/);
  assert.match(captured.sql, /usage\.workorder_id = \$1[\s\S]*usage\.company_id = \$2[\s\S]*usage\.location_id = \$3/);
  assert.deepEqual(captured.values, ["workorder-1", "company-1", "location-1", 2000]);
  assert.deepEqual(parts, [{
    usageId: "usage-1",
    catalogPartId: "part-1",
    partNumber: "013V/23044511",
    serialNumber: "WG-S-7A822F3CA8424AFD-4",
    quantity: 1,
    uomCode: "ea",
    description: "FUEL FILTER",
    repairOrder: "Replace fuel filter",
    status: "installed_pending_approval",
  }]);
});
