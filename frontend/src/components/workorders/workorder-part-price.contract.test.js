import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workorder price column is limited to office/admin and offers exact batch or selling price", async () => {
  const editor = await readFile(new URL("./UsedPartsEditor.jsx", import.meta.url), "utf8");
  const cell = await readFile(new URL("./WorkorderPartPriceCell.jsx", import.meta.url), "utf8");
  assert.match(editor, /\["office",\s*"admin"\]\.includes\(role\)/);
  assert.match(cell, /value="batch_cost"/);
  assert.match(cell, /value="selling_price"/);
  assert.match(cell, /FCFS/);
  assert.match(cell, /costAllocations/);
  assert.match(cell, /cost unavailable/);
  assert.match(cell, /allocationTotal/);
  assert.match(cell, /const recordedTotal = allocation\.totalCost \?\? allocation\.totalPrice/);
  assert.match(cell, /amount === null \|\| amount === undefined/);
  assert.match(cell, /function allocationMoney/);
  assert.match(cell, /Unknown cost/);
  assert.match(cell, /allocationMoney\(lineTotal, allocation\.currency\)/);
});
