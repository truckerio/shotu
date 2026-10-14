import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const noStockLabel = "No stock — service or non-inventory item";

test("inventory tracking controls expose no-stock and lock it for time units", async () => {
  const [editor, createDialog, reviewDialog] = await Promise.all([
    readFile(new URL("./PartIdentityEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("./CreateInventoryPartDialog.jsx", import.meta.url), "utf8"),
    readFile(new URL("./ReviewInventoryCountPartDialog.jsx", import.meta.url), "utf8"),
  ]);

  for (const source of [editor, createDialog]) {
    assert.match(source, new RegExp(`<option value="no_stock">${noStockLabel}</option>`));
    assert.match(source, /trackingModeLockedForUom/);
    assert.match(source, /trackingModeForUom/);
  }
  assert.doesNotMatch(reviewDialog, /<option value="no_stock">/);
  assert.match(reviewDialog, /No-stock items cannot be matched to a physical count/);
  assert.match(editor, /trackingMode: String\(part\.trackingMode \|\| ""\)/);
});
