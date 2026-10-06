import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Workorder detail does not present a client-calculated customer Estimate", () => {
  const source = readFileSync(new URL("./WorkorderDetailPage.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CustomerDocumentReview|draftCustomerDocumentProjection|Preview estimate/);
});
