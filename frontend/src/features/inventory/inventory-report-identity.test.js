import assert from "node:assert/strict";
import test from "node:test";
import { inventoryReportItemKey } from "./inventory-report-identity.js";

test("stock and reconciliation records retain their inventory identity across catalog matches", () => {
  const first = { id: "catalog-part", inventory_item_id: "inventory-one" };
  const second = { id: "catalog-part", inventory_item_id: "inventory-two" };
  const reconciled = { catalog_part_id: "catalog-part", inventory_item_id: "inventory-one" };
  assert.deepEqual([first, second].map(inventoryReportItemKey), ["inventory-one", "inventory-two"]);
  assert.equal(inventoryReportItemKey(reconciled), inventoryReportItemKey(first));
});
