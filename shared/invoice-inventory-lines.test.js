import assert from "node:assert/strict";
import test from "node:test";
import { classifyInvoiceInventoryLines, physicalInvoiceLineIndexes } from "./invoice-inventory-lines.js";

const field = (value) => ({ value });
const line = (partNumber, quantity, lineTotal, unitOfMeasure = "EA") => ({
  partNumber: field(partNumber),
  quantity: field(quantity),
  lineTotal: field(lineTotal),
  unitOfMeasure: field(unitOfMeasure),
});

test("exact same-part charge and credit pairs are financial-only", () => {
  const lines = [
    line("E74-1119:PEC", 1, 1470),
    line("COREECVJ1500-C1:PEC", 1, 1995),
    line("COREECVJ1500-C1:PEC", -1, -1995),
  ];
  assert.deepEqual(classifyInvoiceInventoryLines(lines).map(({ inventoryDisposition, offsetLineIndex }) => ({ inventoryDisposition, offsetLineIndex })), [
    { inventoryDisposition: "stock", offsetLineIndex: null },
    { inventoryDisposition: "financial_offset", offsetLineIndex: 2 },
    { inventoryDisposition: "financial_offset", offsetLineIndex: 1 },
  ]);
  assert.deepEqual([...physicalInvoiceLineIndexes(lines)], [0]);
});

test("similar lines stay physical unless quantity and amount offset exactly", () => {
  const lines = [
    line("CORE-1", 1, 1995),
    line("CORE-1", -1, -1900),
    line("CORE-2", 1, 50),
    line("CORE-2", -1, -50, "each"),
  ];
  assert.deepEqual(classifyInvoiceInventoryLines(lines).map((entry) => entry.inventoryDisposition), ["stock", "stock", "stock", "stock"]);
});
