import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Inbound opens durable no-PO approvals and exact source records", async () => {
  const [approval, inbound] = await Promise.all([
    readFile(new URL("./DirectReceiptApprovalDetail.jsx", import.meta.url), "utf8"),
    readFile(new URL("./InventoryInboundWorkspace.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(approval, /directReceiptApprovalUrl\(approvalId\)/);
  assert.match(approval, /directReceiptApprovalDecisionUrl\(approvalId\)/);
  assert.match(approval, /Approve and receive/);
  assert.match(approval, />Reject</);
  assert.match(approval, /Receipt reference:/);
  assert.match(approval, /No-PO reason/);
  assert.match(approval, /Submitted by/);
  assert.match(approval, /Physical hold location/);
  assert.match(approval, /Damage findings/);
  assert.match(approval, /entered the damage inspection workflow/);
  assert.match(approval, /Usable stock was not added/);
  assert.match(inbound, /initialReceiptId = "", initialDeliveryId = ""/);
  assert.match(inbound, /initialReceiptId \|\| initialDeliveryId/);
  assert.match(inbound, /consumedSourceId === initialSourceId/);
  assert.match(inbound, /setConsumedSourceId\(initialSourceId\)/);
  assert.match(inbound, /\/api\/office\/inventory\/inbound\/\$\{encodeURIComponent\(initialSourceId\)\}/);
  assert.match(inbound, /A closed or missing source falls back to the normal inbound list/);
  assert.doesNotMatch(inbound, /data\.items\.find\(\(item\) => item\.id === initialSourceId/);
  assert.match(inbound, /url\.searchParams\.delete\("receiptId"\); url\.searchParams\.delete\("deliveryId"\)/);
  assert.match(inbound, /title="Selected delivery"/);
  assert.match(inbound, /aria-label="Delivery observations"/);
  assert.match(inbound, /new URLSearchParams\(window\.location\.search\)\.get\("approvalId"\)/);
});
