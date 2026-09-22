import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./InventoryReports.jsx", import.meta.url), "utf8");

test("inventory reports cover reconciliation, receipt cost evidence, open work, and No-PO compliance", () => {
  for (const label of ["Reconciliation", "Latest receipts and costs", "Open tasks and exceptions", "No-PO compliance", "Latest receipt cost evidence", "No-PO compliance trend"]) assert.match(source, new RegExp(label));
  for (const field of ["data?.reconciliation?.rows", "data?.openPurchaseOrders?.items", "data?.receiptBatches?.items", "data?.tasks?.items", "data?.noPo?.items"]) assert.match(source, new RegExp(field.replace(/[.?]/g, "\\$&")));
  assert.match(source, /OperationalDataTable ariaLabel="Reconciliation status"/);
  assert.match(source, /OperationalDataTable ariaLabel="Open inventory tasks and exceptions"/);
  assert.match(source, /OperationalDataTable ariaLabel="No-PO receipt evidence"/);
  assert.match(source, /reconciliationState\(item\)/);
});

test("inventory reports preserve unknown values and emit one formula-safe bounded CSV", () => {
  assert.match(source, /function known\(value\)/);
  assert.match(source, /function count\(value\)/);
  assert.match(source, /replace\(\/\^\[=\+@-\]\//);
  assert.match(source, /csvRows\(data, locationId\)/);
  assert.match(source, /entry\.currency/);
  assert.match(source, /item\.amount === null \|\| !item\.currency/);
  assert.match(source, /period\.amount === null \|\| !period\.currency/);
  assert.match(source, /inventory-report-page-\$\{page\}\.csv/);
  assert.doesNotMatch(source, /stock-report-page/);
});

test("inventory reports link to canonical inventory, workorder, receipt, custody, and approval owners", () => {
  for (const helper of ["inventoryHref", "purchaseHref", "invoiceHref", "receiptHref", "deliveryHref", "taskHref", "custodyHref"]) assert.match(source, new RegExp(`function ${helper}`));
  assert.match(source, /workorderDetailSearch\(item\.original_workorder_id\)/);
  assert.match(source, /taskOwner: "custody"/);
  assert.match(source, /approvalId/);
  assert.match(source, /taskOwner: item\.taskOwner \|\| item\.ownerType \|\| item\.kind/);
});
