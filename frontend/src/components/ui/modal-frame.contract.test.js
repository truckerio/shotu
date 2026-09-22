import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ModalFrame.jsx", import.meta.url), "utf8");

test("shared modal frame owns overlay, modal, and accessible dialog composition", () => {
  assert.match(source, /<ModalOverlay/);
  assert.match(source, /isDismissable=\{isDismissable\}/);
  assert.match(source, /onOpenChange=\{onOpenChange\}/);
  assert.match(source, /<Modal className=\{modalClassName\}>/);
  assert.match(source, /<Dialog/);
  assert.match(source, /aria-label=\{ariaLabel\}/);
  assert.match(source, /aria-labelledby=\{ariaLabelledBy\}/);
  assert.match(source, /aria-describedby=\{ariaDescribedBy\}/);
});
