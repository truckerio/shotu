import assert from "node:assert/strict";
import test from "node:test";
import { inboundAction, inboundCount, inboundProgress, inboundReference, inboundRequestUrl, inboundStatus } from "./inventory-inbound-model.js";

test("inbound request keeps filtering on the server and omits empty filters", () => {
  assert.equal(inboundRequestUrl({ view: "expected", locationId: "shop-1", query: "  ACME  ", page: 2 }), "/api/office/inventory/inbound?view=expected&page=2&locationId=shop-1&q=ACME");
  assert.equal(inboundRequestUrl({ view: "my_work", locationId: "", query: "" }), "/api/office/inventory/inbound?view=my_work&page=1");
});

test("inbound rows make PO absence and receipt progress explicit", () => {
  const item = { noPoUsed: true, noPoReason: "Counter delivery", receivedQuantity: 2, expectedQuantity: 5, uomCodes: ["ea"] };
  assert.equal(inboundReference(item), "No PO used · Counter delivery");
  assert.equal(inboundProgress(item), "2 received of 5 ea");
  assert.equal(inboundCount({ needs_attention: 3 }, "needs_attention"), 3);
  assert.equal(inboundCount({ myWork: 4 }, "my_work"), 4);
});

test("unresolved invoices use neutral PO resolution language until a no-PO receipt exists", () => {
  assert.equal(inboundReference({ kind: "invoice", nextAction: "resolve_no_po", poNumber: "PO-MISMATCH", noPoUsed: false }), "PO reference PO-MISMATCH · Needs resolution");
  assert.equal(inboundReference({ kind: "invoice", nextAction: "resolve_no_po", poNumber: null, noPoUsed: false }), "PO decision needed");
  assert.equal(inboundReference({ kind: "receipt", nextAction: "none", noPoUsed: true, noPoReason: "Counter delivery" }), "No PO used · Counter delivery");
});

test("inbound handoffs prefer the existing invoice and PO owners", () => {
  assert.deepEqual(inboundAction({ invoiceRunId: "run-1", nextAction: "receive_invoice" }), { id: "invoice", label: "Open invoice" });
  assert.deepEqual(inboundAction({ invoiceRunId: "run-1", noPoUsed: true, nextAction: "resolve_no_po" }), { id: "invoice", label: "Open invoice" });
  assert.deepEqual(inboundAction({ invoiceRunId: "run-1", poId: "po-1", nextAction: "receive_goods" }), { id: "purchase_order", label: "Receive PO" });
  assert.deepEqual(inboundAction({ noPoUsed: true, nextAction: "review_invoice" }), { id: "invoice_upload", label: "Upload invoice" });
  assert.equal(inboundAction({ poId: "po-1", nextAction: "review_exception" }), null);
});

test("inbound progress avoids attaching one unit to mixed-unit orders", () => {
  assert.equal(inboundProgress({ receivedQuantity: 2, expectedQuantity: 5, uomCodes: ["ea", "ft"] }), "2 unit types");
  assert.equal(inboundProgress({ kind: "invoice", expectedQuantity: 0 }), "Ready for receiving review");
});

test("invoice intake status and progress use the canonical inbound row", () => {
  const item = { id: "needs-review", kind: "invoice_intake", invoiceRunId: "needs-review", invoiceStatus: "needs_review", nextAction: "needs_review" };
  assert.equal(inboundStatus(item), "Needs review");
  assert.deepEqual(inboundAction(item), { id: "invoice", label: "Open invoice" });
  assert.equal(inboundProgress({ kind: "invoice_intake", invoiceStatus: "failed" }), "Open to retry extraction");
});

test("invoice intake rows never claim a no-PO receipt before stock is posted", () => {
  const item = { kind: "invoice_intake", invoiceNumber: "INV-42", nextAction: "failed" };
  assert.equal(inboundReference(item), "Invoice INV-42");
  assert.deepEqual(inboundAction(item), { id: "invoice", label: "Open invoice" });
});

test("completed and reversed invoice receipts keep their status and review action", () => {
  for (const invoiceStatus of ["added", "reversed"]) {
    const item = { kind: "receipt", invoiceRunId: `run-${invoiceStatus}`, invoiceStatus, nextAction: "none" };
    assert.equal(inboundStatus(item), invoiceStatus === "added" ? "Added to inventory" : "Reversed");
    assert.equal(inboundProgress(item), invoiceStatus === "added" ? "Inventory entry completed" : "Inventory entry reversed");
    assert.deepEqual(inboundAction(item), { id: "invoice", label: "Open invoice" });
  }
});
