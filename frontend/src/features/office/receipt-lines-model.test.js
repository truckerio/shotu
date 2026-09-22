import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { initialReceiptLines, initialReceiptLinesFromFacts, normalizeReceiptLineTarget, receiptLineLimit, receiptLinePayload, receiptLinesReady, receiveAllReceiptLines, updateReceiptLine } from "./receipt-lines-model.js";

const field = (value) => ({ value });
const draft = { lines: [
  { partNumber: field("SER-1"), description: field("Serialized"), quantity: field(2), unitOfMeasure: field("ea") },
  { partNumber: field("BULK-1"), description: field("Bulk"), quantity: field(1.5), unitOfMeasure: field("gal") },
] };
const suggestion = { candidates: [
  { invoiceLineIndex: 0, purchaseLineId: "line-serialized", candidate: { tracking_mode: "serialized", outstanding_quantity: 2, uom_code: "ea" } },
  { invoiceLineIndex: 1, candidate: { tracking_mode: "measured_bulk", outstanding_quantity: 1.5, uom_code: "gal" } },
] };

test("receiving facts use server tracking and outstanding quantity without inferring serialized units", () => {
  const lines = initialReceiptLines(draft, suggestion);
  assert.equal(lines[0].trackingMode, "serialized");
  assert.equal(lines[1].trackingMode, "measured_bulk");
  assert.equal(lines[1].remainingQuantity, 1.5);
  lines[0].acceptedQuantity = "1";
  assert.equal(receiptLinePayload(lines)[0].purchaseLineId, "line-serialized");
});

test("serialized receipts require one unique identity per accepted or held unit while bulk remains aggregate", () => {
  const lines = initialReceiptLines(draft, suggestion);
  lines[0] = { ...lines[0], acceptedQuantity: "2", serialNumbers: "A-1\nA-2" };
  lines[1] = { ...lines[1], acceptedQuantity: "1.5" };
  assert.equal(receiptLinesReady(lines), true);
  assert.deepEqual(receiptLinePayload(lines)[1].serialNumbers, []);
  assert.equal(receiptLinePayload(lines)[0].outcome, "accepted");
  assert.equal(receiptLinesReady([{ ...lines[0], serialNumbers: "A-1" }, lines[1]]), false);
});

test("receipts fail closed until every line has authoritative tracking mode facts", () => {
  const lines = initialReceiptLines(draft, suggestion);
  lines[0] = { ...lines[0], acceptedQuantity: "2", serialNumbers: "A-1\nA-2", trackingMode: null };
  lines[1] = { ...lines[1], acceptedQuantity: "1.5" };
  assert.equal(receiptLinesReady(lines), false);
});

test("receive all uses each line's bounded limit but deliberately leaves serialized identities for physical entry", () => {
  const lines = initialReceiptLines(draft, suggestion);
  const received = receiveAllReceiptLines(lines);
  assert.equal(receiptLineLimit(received[0]), 2);
  assert.equal(receiptLineLimit(received[1]), 1.5);
  assert.equal(received[0].acceptedQuantity, "2");
  assert.equal(received[1].acceptedQuantity, "1.5");
  assert.equal(received[0].serialNumbers, "");
  assert.equal(receiptLinesReady(received), false);
  assert.equal(receiptLinesReady([{ ...received[0], serialNumbers: "A-1\nA-2" }, received[1]]), true);
});

test("held quantities require a hold location and findings and no-receipt payload cannot post", () => {
  const [line] = initialReceiptLines(draft, suggestion);
  const held = { ...line, heldQuantity: "1", serialNumbers: "A-1", holdLocation: "Quarantine A", notes: "Crushed carton", outcome: "damaged" };
  assert.equal(receiptLinesReady([held]), true);
  assert.equal(receiptLinesReady([{ ...held, holdLocation: "" }]), false);
  assert.equal(receiptLinesReady([{ ...line, notReceivedQuantity: "2", outcome: "short", notes: "Short delivery" }]), true);
});

test("shortage-only receipt payload is ready without a stock quantity", () => {
  const [line] = initialReceiptLines(draft, suggestion);
  const shortage = { ...line, notReceivedQuantity: "2", outcome: "short", notes: "Supplier shorted the line" };
  assert.deepEqual(receiptLinePayload([shortage]), [{
    invoiceLineIndex: 0,
    acceptedQuantity: 0,
    heldQuantity: 0,
    rejectedQuantity: 0,
    notReceivedQuantity: 2,
    outcome: "short",
    notes: "Supplier shorted the line",
    holdLocation: "",
    serialNumbers: [],
    purchaseLineId: "line-serialized",
  }]);
  assert.equal(receiptLinesReady([shortage]), true);
});

test("generated partial payloads retain the frontend receipt command contract", () => {
  const purchaseLineId = "line-serialized";
  const lines = initialReceiptLines(draft, {
    candidates: [{ invoiceLineIndex: 0, purchaseLineId, candidate: { tracking_mode: "serialized", outstanding_quantity: 2, uom_code: "ea" } }],
  });
  lines[0] = { ...lines[0], acceptedQuantity: "1", serialNumbers: "SER-1" };
  const receiptLines = receiptLinePayload(lines);
  assert.deepEqual(receiptLines, [{
    invoiceLineIndex: 0,
    acceptedQuantity: 1,
    heldQuantity: 0,
    rejectedQuantity: 0,
    notReceivedQuantity: 0,
    outcome: "accepted",
    notes: "",
    holdLocation: "",
    serialNumbers: ["SER-1"],
    purchaseLineId,
  }]);
  assert.deepEqual(receiptLines.map(({ invoiceLineIndex: _invoiceLineIndex, ...line }) => line), [{
    acceptedQuantity: 1,
    heldQuantity: 0,
    rejectedQuantity: 0,
    notReceivedQuantity: 0,
    outcome: "accepted",
    notes: "",
    holdLocation: "",
    serialNumbers: ["SER-1"],
    purchaseLineId,
  }]);

  const noPurchaseLinePayload = receiptLinePayload([{ ...initialReceiptLines(draft, suggestion)[1], acceptedQuantity: "1.5" }]);
  assert.deepEqual(noPurchaseLinePayload, [{
    invoiceLineIndex: 1,
    acceptedQuantity: 1.5,
    heldQuantity: 0,
    rejectedQuantity: 0,
    notReceivedQuantity: 0,
    outcome: "accepted",
    notes: "",
    holdLocation: "",
    serialNumbers: [],
  }]);
  assert.equal(Object.hasOwn(noPurchaseLinePayload[0], "purchaseLineId"), false);
});

test("exact put-away is optional for accepted quantity and is never sent for held, rejected, wrong, or short-only lines", () => {
  const positions = [{ id: "aisle-a", name: "Aisle A", usage: "storage", canStore: true, isPickable: true }];
  const [serialized, bulk] = initialReceiptLines(draft, suggestion);
  const quantity = { ...bulk, trackingMode: "quantity", acceptedQuantity: "2", targetPositionId: "aisle-a" };
  const measured = { ...bulk, acceptedQuantity: "1.5", targetPositionId: "aisle-a" };
  const serializedAccepted = { ...serialized, acceptedQuantity: "1", serialNumbers: "SER-1", targetPositionId: "aisle-a" };
  for (const line of [quantity, measured, serializedAccepted]) {
    assert.equal(receiptLinePayload([line])[0].targetPositionId, "aisle-a");
  }
  for (const line of [
    { ...quantity, acceptedQuantity: "0", heldQuantity: "2", targetPositionId: "aisle-a", outcome: "damaged", holdLocation: "Hold A", notes: "Damage" },
    { ...quantity, acceptedQuantity: "0", rejectedQuantity: "2", targetPositionId: "aisle-a", outcome: "wrong", notes: "Wrong item" },
    { ...quantity, acceptedQuantity: "0", notReceivedQuantity: "2", targetPositionId: "aisle-a", outcome: "short", notes: "Short" },
  ]) {
    assert.equal(Object.hasOwn(receiptLinePayload([line])[0], "targetPositionId"), false);
  }
  assert.equal(normalizeReceiptLineTarget({ ...quantity, targetPositionId: "gone" }, positions).targetPositionId, "");
});

test("changing accepted quantity or clearing a target removes stale put-away evidence", () => {
  const positions = [{ id: "shelf-a", name: "Shelf A", usage: "storage", canStore: true, isPickable: true }];
  const line = { ...initialReceiptLines(draft, suggestion)[1], acceptedQuantity: "1.5", targetPositionId: "shelf-a" };
  assert.equal(updateReceiptLine(line, "acceptedQuantity", "0", positions).targetPositionId, "");
  assert.equal(updateReceiptLine(line, "targetPositionId", "", positions).targetPositionId, "");
  assert.equal(updateReceiptLine(line, "acceptedQuantity", "1", positions).targetPositionId, "shelf-a");
});

test("direct-arrival lines restore their draft and support only accepted or held quantities without a source limit", () => {
  const [available] = initialReceiptLinesFromFacts([{
    invoiceLineIndex: 0, partNumber: "DIRECT-1", description: "Direct part", uomCode: "ea", trackingMode: "serialized", receiptMode: "direct-arrival",
  }], [{ acceptedQuantity: "2", serialNumbers: "A-1\nA-2", targetPositionId: "shelf-a" }]);
  assert.equal(receiptLineLimit(available), Infinity);
  assert.equal(receiptLinesReady([available]), true);
  assert.equal(receiptLinePayload([available])[0].targetPositionId, "shelf-a");
  const held = { ...available, acceptedQuantity: "", heldQuantity: "2", targetPositionId: "", outcome: "held", holdLocation: "Quarantine", notes: "Damaged carton" };
  assert.equal(receiptLinesReady([held]), true);
  assert.equal(Object.hasOwn(receiptLinePayload([held])[0], "targetPositionId"), false);
  assert.equal(receiptLinesReady([{ ...held, outcome: "wrong" }]), false);
  assert.equal(receiptLinesReady([{ ...held, rejectedQuantity: "1" }]), false);
});

test("shared receipt editor exposes the narrow position handoff without fetching positions", async () => {
  const source = await readFile(new URL("./ReceiptLinesEditor.jsx", import.meta.url), "utf8");
  assert.match(source, /StoragePositionPicker/);
  assert.match(source, /positions = emptyPositions, positionLoading = false, positionError = ""/);
  assert.match(source, /mode = "receipt"/);
  assert.match(source, /mode === "direct-arrival"/);
  assert.match(source, /Number\(line\.acceptedQuantity \|\| 0\) > 0/);
  assert.match(source, /normalizeReceiptLineTarget\(line, positions\)/);
  assert.doesNotMatch(source, /fetch\(/);
});
