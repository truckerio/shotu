import assert from "node:assert/strict";
import { test } from "node:test";
import { directArrivalInitialLines, directArrivalReceiptFacts, directReceiptErrorMessage, directReceiptPayload, receiptDraftKey, restoreReceiptDraft } from "./direct-receipt-model.js";
const part = { catalogPartId: "part", version: 2, trackingMode: "quantity", canonicalUomCode: "ea", uomCode: "pc" };
const draft = { locationId: "shop", quantity: "2", confirmed: true, serials: "", noPurchaseOrderReason: "Counter delivery" };
test("explicit receipt location cannot inherit another shop's unsubmitted stock or confirmation", () => {
  const fresh = { locationId: "shop-B", quantity: "", serials: "", confirmed: false, attempt: null };
  assert.deepEqual(restoreReceiptDraft(draft, fresh), fresh);
  assert.equal(restoreReceiptDraft(draft, { ...fresh, locationId: "shop" }).quantity, "2");
  assert.equal(restoreReceiptDraft(draft, { ...fresh, locationId: "" }).locationId, "shop");
});
test("uncertain receipt remains recoverable with its original location and immutable payload", () => {
  const attempt = directReceiptPayload(part, draft, "original-key");
  const saved = { ...draft, attempt };
  assert.equal(restoreReceiptDraft(saved, { locationId: "shop-B" }), saved);
  assert.equal(restoreReceiptDraft(saved, { locationId: "shop-B" }).attempt, attempt);
});
test("receipt uses canonical unit and explicit physical confirmation", () => {
  const result = directReceiptPayload(part, draft, "command");
  assert.equal(result.uomCode, "ea");
  assert.equal(result.quantity, 2);
  assert.equal(result.expectedPartVersion, 2);
  assert.throws(() => directReceiptPayload(part, { ...draft, confirmed: false }, "command"));
  assert.throws(() => directReceiptPayload(part, { ...draft, quantity: "" }, "command"));
  assert.throws(() => directReceiptPayload(part, { ...draft, quantity: "1.5" }, "command"));
});
test("serial count comes from captured identities, not a typed aggregate amount", () => {
  const serialized = { ...part, trackingMode: "serialized" };
  const result = directReceiptPayload(serialized, { ...draft, quantity: "500", serials: "A1\nA2\n" }, "command");
  assert.equal(result.quantity, 2);
  assert.deepEqual(result.serialNumbers, ["A1", "A2"]);
  assert.throws(() => directReceiptPayload(serialized, { ...draft, serials: "A1\na1" }, "command"));
});
test("receipt includes an exact storage target only when one is selected", () => {
  assert.equal(directReceiptPayload(part, { ...draft, targetPositionId: "shelf" }, "command").targetPositionId, "shelf");
  assert.equal("targetPositionId" in directReceiptPayload(part, draft, "command"), false);
  assert.equal("targetPositionId" in directReceiptPayload(part, { ...draft, targetPositionId: "shelf", disposition: "held", holdLocation: "Cage", damageDetails: "Damaged" }, "command"), false);
});
test("draft identities are scoped to actor, company and part", () => {
  assert.notEqual(receiptDraftKey("a", "c", "p"), receiptDraftKey("b", "c", "p"));
  assert.notEqual(receiptDraftKey("a", "c", "p"), receiptDraftKey("a", "d", "p"));
});

test("PO catalog versions returned as bigint strings are sent as numbers", () => {
  const result = directReceiptPayload({ ...part, version: "3", purchaseLineId: "line" }, draft, "command");
  assert.equal(result.expectedPartVersion, 3);
  assert.equal(result.purchaseLineId, "line");
  for (const version of [null, undefined, "", "abc", "0", "1.5", "9007199254740993"]) {
    assert.throws(() => directReceiptPayload({ ...part, version }, draft, "command"), /Refresh the part/);
  }
  const uncatalogued = directReceiptPayload({ trackingMode: "quantity", uomCode: "ea", purchaseLineId: "line" }, draft, "command");
  assert.equal(uncatalogued.expectedPartVersion, undefined);
});
test("standalone arrivals require durable no-PO evidence while PO lines stay low-friction", () => {
  assert.throws(() => directReceiptPayload(part, { ...draft, noPurchaseOrderReason: "" }, "command"), /without a purchase order/);
  const standalone = directReceiptPayload(part, { ...draft, reference: "Dock ticket 7" }, "command");
  assert.equal(standalone.noPurchaseOrderReason, "Counter delivery");
  assert.equal(standalone.reference, "Dock ticket 7");
  const purchaseLine = directReceiptPayload({ ...part, purchaseLineId: "line" }, { ...draft, noPurchaseOrderReason: "" }, "command");
  assert.equal("noPurchaseOrderReason" in purchaseLine, false);
  assert.throws(() => directReceiptPayload({ ...part, purchaseRequestId: "legacy-request", expectedRequestVersion: 1 }, { ...draft, noPurchaseOrderReason: "" }, "command"), /without a purchase order/);
  assert.equal(directReceiptPayload({ ...part, purchaseRequestId: "legacy-request", expectedRequestVersion: 1 }, draft, "command").noPurchaseOrderReason, "Counter delivery");
  assert.match(directReceiptErrorMessage({ code: "INVENTORY_DIRECT_RECEIPT_APPROVAL_FORBIDDEN" }), /purchasing approval/);
  assert.equal(directReceiptErrorMessage({ status: 403, message: "You cannot receive stock for this shop." }), "You cannot receive stock for this shop.");
});

test("shared direct-arrival line state translates only accepted or held inventory truth", () => {
  assert.deepEqual(directArrivalReceiptFacts(part), [{
    invoiceLineIndex: 0, partNumber: "Part", description: "", uomCode: "ea", trackingMode: "quantity", receiptMode: "direct-arrival",
  }]);
  const accepted = directReceiptPayload(part, { ...draft, receiptLines: [{
    ...directArrivalReceiptFacts(part)[0], acceptedQuantity: "2", heldQuantity: "", rejectedQuantity: "", notReceivedQuantity: "", outcome: "available", notes: "", holdLocation: "", serialNumbers: "", targetPositionId: "shelf",
  }] }, "command");
  assert.equal(accepted.quantity, 2);
  assert.equal(accepted.targetPositionId, "shelf");
  const held = directReceiptPayload(part, { ...draft, receiptLines: [{
    ...directArrivalReceiptFacts(part)[0], acceptedQuantity: "", heldQuantity: "2", rejectedQuantity: "", notReceivedQuantity: "", outcome: "held", notes: "Damaged carton", holdLocation: "Quarantine", serialNumbers: "", targetPositionId: "",
  }] }, "command");
  assert.equal(held.disposition, "held");
  assert.equal(held.damageDetails, "Damaged carton");
  assert.equal("targetPositionId" in held, false);
  assert.throws(() => directReceiptPayload(part, { ...draft, receiptLines: [{
    ...directArrivalReceiptFacts(part)[0], acceptedQuantity: "", heldQuantity: "", rejectedQuantity: "2", notReceivedQuantity: "", outcome: "wrong", notes: "Wrong", holdLocation: "", serialNumbers: "", targetPositionId: "",
  }] }, "command"), /available or held/);
});

test("legacy direct drafts seed the shared line without losing receipt recovery", () => {
  assert.deepEqual(directArrivalInitialLines(part, { quantity: "2", serials: "A-1", targetPositionId: "shelf" })[0], {
    ...directArrivalReceiptFacts(part)[0], acceptedQuantity: "2", heldQuantity: "", rejectedQuantity: "", notReceivedQuantity: "", outcome: "available", notes: "", holdLocation: "", serialNumbers: "A-1", targetPositionId: "shelf",
  });
  assert.deepEqual(directArrivalInitialLines(part, { quantity: "2", disposition: "held", holdLocation: "Cage", damageDetails: "Bent" })[0], {
    ...directArrivalReceiptFacts(part)[0], acceptedQuantity: "", heldQuantity: "2", rejectedQuantity: "", notReceivedQuantity: "", outcome: "held", notes: "Bent", holdLocation: "Cage", serialNumbers: "", targetPositionId: "",
  });
});

test("a rejected stale destination can be removed without changing direct receipt facts", () => {
  const stale = directReceiptPayload(part, { ...draft, targetPositionId: "stale-bin" }, "original-command");
  const corrected = directReceiptPayload(part, { ...draft, targetPositionId: "" }, "replacement-command");
  assert.equal(stale.quantity, corrected.quantity);
  assert.equal(stale.noPurchaseOrderReason, corrected.noPurchaseOrderReason);
  assert.equal("targetPositionId" in corrected, false);
  assert.equal(stale.idempotencyKey, "original-command");
  assert.equal(corrected.idempotencyKey, "replacement-command");
});
