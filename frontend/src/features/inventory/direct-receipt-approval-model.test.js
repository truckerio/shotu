import assert from "node:assert/strict";
import test from "node:test";
import { directReceiptApprovalCost, directReceiptApprovalDecision, directReceiptApprovalPresentation, directReceiptApprovalStatus, directReceiptApprovalUrl, isDirectReceiptApprovalRefreshError } from "./direct-receipt-approval-model.js";

test("approval model keeps durable request identity and optimistic version", () => {
  assert.equal(directReceiptApprovalUrl("request/id"), "/api/office/inventory/direct-receipt-approvals/request%2Fid");
  assert.deepEqual(directReceiptApprovalDecision("reject", { approvalRequest: { version: 3 } }, "  Wrong delivery  "), { action: "reject", expectedVersion: 3, reason: "Wrong delivery" });
});

test("approval model presents stable statuses, costs and refresh conflicts", () => {
  assert.equal(directReceiptApprovalStatus("pending"), "Approval needed");
  assert.equal(directReceiptApprovalStatus("approved"), "Approved");
  assert.equal(directReceiptApprovalCost(null), "Not provided");
  assert.match(directReceiptApprovalCost(12.5), /12\.50/);
  assert.equal(isDirectReceiptApprovalRefreshError({ code: "INVENTORY_DIRECT_RECEIPT_APPROVAL_STALE" }), true);
  assert.equal(isDirectReceiptApprovalRefreshError({ code: "validation_error" }), false);
});

test("approval presentation distinguishes usable stock from immutable held-arrival evidence", () => {
  assert.deepEqual(directReceiptApprovalPresentation({ arrival: { disposition: "held" } }), {
    held: true,
    dispositionLabel: "Held for inspection",
    confirmationLabel: "Goods received and placed on hold",
    destinationLabel: "Not applicable — held for inspection",
    successHeading: "Held for inspection",
    successNotice: "Arrival approved and entered the damage inspection workflow.",
  });
  assert.equal(directReceiptApprovalPresentation({ arrival: { disposition: "accepted" }, destination: { path: "A1 · Shelf 2" } }).destinationLabel, "A1 · Shelf 2");
});
