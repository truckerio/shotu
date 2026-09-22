import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { getPurchaseInvoiceSuggestions, validateCompleteInvoiceAllocationPlan, validateInvoicePostingRoute } from "./inventory-purchase-invoice-allocation.service.js";
import { confirmLocalReceiptSchema } from "./inventory.schemas.js";

const migration = readFileSync(new URL("../../db/migrations/153_purchase_invoice_allocations.sql", import.meta.url), "utf8");
const receiptRepository = readFileSync(new URL("../../db/repositories/local-inventory.repo.js", import.meta.url), "utf8");
const ID = "00000000-0000-4000-8000-000000000101";
const draft = { purchaseOrderNumber: { value: "" } };

test("allocation migration records reviewed invoice line identity and posted receipt linkage", () => {
  assert.match(migration, /inventory_purchase_invoice_allocations/);
  assert.match(migration, /unique \(company_id, invoice_run_id, invoice_line_index, purchase_line_id\)/i);
  assert.match(migration, /foreign key \(company_id, receipt_line_id\) references inventory_receipt_lines/i);
  assert.match(migration, /status = 'posted' and receipt_line_id is not null and posted_at is not null/i);
  assert.match(migration, /create index inventory_purchase_invoice_allocations_line/i);
  assert.match(migration, /posting_route text not null/i);
  assert.match(migration, /local_inventory_receipts_no_po_reason_required/i);
});

test("invoice allocation path locks PO lines before canonical receipt allocation", () => {
  assert.match(receiptRepository, /sort\(\(a, b\) => a\.purchaseLineId\.localeCompare\(b\.purchaseLineId\)\)/);
  assert.match(receiptRepository, /for update of o,l/);
  assert.match(receiptRepository, /insert into inventory_purchase_receipt_allocations/);
  assert.match(receiptRepository, /update inventory_purchase_lines set received_quantity=received_quantity\+\$3/);
});

test("invoice posting route requires an allocation when a PO route is selected", () => {
  assert.throws(() => validateInvoicePostingRoute({ draft, postingRoute: "purchase_order", allocationPlan: [{ invoiceLineIndex: 0, purchaseLineId: ID, quantity: 1 }] }), /purchase order number is required/);
  assert.throws(() => validateInvoicePostingRoute({ draft: { purchaseOrderNumber: { value: "PO-1" } }, postingRoute: "purchase_order", allocationPlan: [] }), /exact purchase order allocation/);
  assert.throws(() => validateInvoicePostingRoute({ draft: { purchaseOrderNumber: { value: "PO-1" } }, postingRoute: "no_purchase_order", allocationPlan: [] }), /Explain why/);
  assert.throws(() => validateInvoicePostingRoute({ draft: { purchaseOrderNumber: { value: "PO-1" } }, postingRoute: "no_purchase_order", noPurchaseOrderReason: "Explicit no-PO route", allocationPlan: [{ invoiceLineIndex: 0, purchaseLineId: ID, quantity: 1 }] }), /cannot include/);
  assert.throws(() => validateInvoicePostingRoute({ draft: { purchaseOrderNumber: { value: "PO-1" } }, postingRoute: "no_purchase_order", noPurchaseOrderReason: "Explicit no-PO route", allocationPlan: [], receiptLines: [{ invoiceLineIndex: 0, purchaseLineId: ID, acceptedQuantity: 1 }] }), /cannot include purchase order line references/);
  assert.equal(validateInvoicePostingRoute({ draft, postingRoute: "no_purchase_order", allocationPlan: [], noPurchaseOrderReason: "Vendor invoice was not tied to a PO." }), "no_purchase_order");
  assert.throws(() => validateInvoicePostingRoute({ draft, postingRoute: "no_purchase_order", allocationPlan: [], noPurchaseOrderReason: "" }), /Explain why/);
  assert.throws(() => validateInvoicePostingRoute({ draft, allocationPlan: [], noPurchaseOrderReason: "" }), /Explain why/);
  assert.throws(() => validateInvoicePostingRoute({ draft, postingRoute: "no_purchase_order", noPurchaseOrderReason: "Supplier did not issue a PO.", allocationPlan: [{ invoiceLineIndex: 0, purchaseLineId: ID, quantity: 1 }] }), /cannot include/);
});

test("no-PO repository defense strips receipt outcome PO lineage before persistence", () => {
  assert.match(receiptRepository, /postingRoute === "no_purchase_order"[\s\S]*purchaseLineId: null/);
  assert.match(receiptRepository, /const usesPurchaseOrder = \(!direct && postingRoute === "purchase_order"\) \|\| Boolean\(direct\?\.purchaseOrderId\)/);
});

test("receipt schema accepts a deterministic allocation plan and explicit route", () => {
  const parsed = confirmLocalReceiptSchema.parse({
    expectedVersion: 2,
    idempotencyKey: "invoice-command-1",
    confirmation: "all_received_undamaged",
    postingRoute: "purchase_order",
    allocationPlan: [{ invoiceLineIndex: 0, purchaseLineId: ID, quantity: 2 }],
  });
  assert.equal(parsed.allocationPlan[0].purchaseLineId, ID);
  assert.equal(parsed.noPurchaseOrderReason, "");
});

test("purchase-order posting allocates every accepted line exactly once", () => {
  const lines = [{ quantity: 2 }, { quantity: 1 }];
  assert.throws(() => validateCompleteInvoiceAllocationPlan({ lines, allocationPlan: [{ invoiceLineIndex: 0, purchaseLineId: ID, quantity: 2 }] }), /every invoice line/);
  assert.throws(() => validateCompleteInvoiceAllocationPlan({ lines, allocationPlan: [{ invoiceLineIndex: 0, purchaseLineId: ID, quantity: 1 }, { invoiceLineIndex: 1, purchaseLineId: ID, quantity: 1 }] }), /accepted invoice quantity/);
  assert.throws(() => validateCompleteInvoiceAllocationPlan({ lines, allocationPlan: [{ invoiceLineIndex: 0, purchaseLineId: ID, quantity: 2 }, { invoiceLineIndex: 0, purchaseLineId: ID, quantity: 2 }] }), /accepted invoice quantity/);
  assert.doesNotThrow(() => validateCompleteInvoiceAllocationPlan({ lines, allocationPlan: [{ invoiceLineIndex: 0, purchaseLineId: ID, quantity: 2 }, { invoiceLineIndex: 1, purchaseLineId: `${ID.slice(0, -1)}2`, quantity: 1 }] }));
  assert.doesNotThrow(() => validateCompleteInvoiceAllocationPlan({ lines, receiptLines: [{ invoiceLineIndex: 0, usableQuantity: 1 }], allocationPlan: [{ invoiceLineIndex: 0, purchaseLineId: ID, quantity: 1 }] }));
});

test("suggestion service forwards tenant and location scope without choosing a fuzzy candidate", async () => {
  let input;
  const result = await getPurchaseInvoiceSuggestions(new URLSearchParams({ runId: ID }), {
    actor: { id: ID, role: "office" }, companyIds: new Set([ID]), locationIds: new Set([ID]),
  }, { loadInvoiceLocation: async () => ({ location_id: ID }), loadLocation: async () => ({ id: ID, company_id: ID }), suggest: async (value) => { input = value; return { kind: "ambiguous", candidates: [] }; } });
  assert.equal(result.kind, "ambiguous");
  assert.deepEqual(input.companyIds, [ID]);
  assert.deepEqual(input.locationIds, [ID]);
  assert.equal(input.isAdmin, false);
});
