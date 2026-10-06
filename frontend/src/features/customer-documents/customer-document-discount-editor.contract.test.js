import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(new URL("./customer-estimate-api.js", import.meta.url), "utf8");
const editor = readFileSync(new URL("./CustomerDocumentDiscountEditor.jsx", import.meta.url), "utf8");
const create = readFileSync(new URL("../create-workorder/CreateWorkorderPage.jsx", import.meta.url), "utf8");
const createForm = readFileSync(new URL("../generator/CreateWorkorderForm.jsx", import.meta.url), "utf8");
const createParts = readFileSync(new URL("../workorder-modules/parts/CreatePartsModule.jsx", import.meta.url), "utf8");
const workorder = readFileSync(new URL("./WorkorderCustomerDocumentsPanel.jsx", import.meta.url), "utf8");

test("Estimate commands replay the same server-authoritative adjustments for preview and issue", () => {
  assert.match(api, /adjustments: normalizedAdjustments\(adjustments\)/g);
  assert.match(create, /previewDraftEstimate\([\s\S]*adjustments: customerAdjustments/);
  assert.match(create, /issueDraftEstimate\([\s\S]*adjustments: customerAdjustments/);
  assert.match(workorder, /adjustments: documentType === "estimate" \? adjustments/);
  assert.match(workorder, /adjustments: previewType === "estimate" \? adjustments/);
});

test("discount editing clears an unissued stale projection without calculating totals in the client", () => {
  assert.match(create, /function updateCustomerAdjustments\(next\)[\s\S]*setCustomerProjection\(null\)[\s\S]*issueKeyRef\.current = ""/);
  assert.match(workorder, /function updateAdjustments\(next\)[\s\S]*setProjection\(null\)[\s\S]*issueKeyRef\.current = ""/);
  assert.doesNotMatch(editor, /subtotal|grand total|taxTotal|totalAmount/i);
});

test("discount editor uses the shared Dropdown and sits directly below the create-workorder total", () => {
  assert.match(editor, /import \{ Dropdown \}/);
  assert.match(editor, /<Dropdown aria-label="Discount type" disabled=\{disabled\}/);
  assert.match(editor, /<option value="percentage">Percentage<\/option>/);
  assert.match(editor, /<option value="fixed">Fixed amount<\/option>/);
  assert.match(editor, /required minLength="2" maxLength="500"/);
  assert.match(create, /readCustomerDocumentProfile/);
  assert.match(create, /<CustomerDocumentDiscountEditor[\s\S]*inline[\s\S]*customerDiscountControl=\{customerDiscountControl\}/);
  assert.match(create, /customerDiscountControl=\{customerDiscountControl\}/);
  assert.match(createForm, /discountControl: customerDiscountControl/);
  assert.match(createParts, /<CreatePricingTotal pricing=\{pricing\} \/>\s*\{discountControl\}/);
});
