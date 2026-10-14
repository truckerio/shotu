import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(new URL("./customer-estimate-api.js", import.meta.url), "utf8");
const editor = readFileSync(new URL("./CustomerDocumentDiscountEditor.jsx", import.meta.url), "utf8");
const editorStyles = readFileSync(new URL("./customer-document-discount-editor.css", import.meta.url), "utf8");
const create = readFileSync(new URL("../create-workorder/CreateWorkorderPage.jsx", import.meta.url), "utf8");
const createForm = readFileSync(new URL("../generator/CreateWorkorderForm.jsx", import.meta.url), "utf8");
const createParts = readFileSync(new URL("../workorder-modules/parts/CreatePartsModule.jsx", import.meta.url), "utf8");
const workorder = readFileSync(new URL("./WorkorderCustomerDocumentsPanel.jsx", import.meta.url), "utf8")
  + readFileSync(new URL("./useWorkorderCustomerDocuments.js", import.meta.url), "utf8");

test("inline discount presents the shared selector without an input box while retaining focus and mobile targets", () => {
  assert.match(editorStyles, /\.customer-document-discount-editor\.is-inline \.customer-document-discount-type\s*\{[^}]*font-weight: 400;/s);
  assert.match(editorStyles, /\.is-inline \.customer-document-discount-type \.dropdown-select-trigger\s*\{[^}]*background: transparent;[^}]*border-color: transparent;/);
  assert.match(editorStyles, /\.dropdown-select-trigger\[data-focus-visible\]\s*\{[^}]*border-color: #1570ef;/);
  assert.match(editorStyles, /@media \(max-width: 700px\)\s*\{[^}]*\.dropdown-select-trigger\s*\{[^}]*min-height: 44px;/);
});

test("inline discount details live in an anchored dialog rather than widening the pricing footer", () => {
  assert.match(editor, /<header className="customer-document-discount-popover-header"><h3>Discount<\/h3><Button onPress=\{\(\) => setDetailsOpen\(false\)\}>Done<\/Button><\/header>/);
  assert.doesNotMatch(editor, /Changes autosave to this draft/);
  assert.match(editor, /<DialogTrigger isOpen=\{detailsOpen\}/);
  assert.match(editor, /aria-label=\{`Edit discount: \$\{discountSummary\}`\}/);
  assert.match(editor, /discountDisplay\(discount, projection\)/);
  assert.match(editor, /discountSummary !== "—" \? " has-discount" : ""/);
  assert.doesNotMatch(editor, /active \? " has-discount"/);
  assert.match(editor, /<span className="customer-document-discount-value">\{discountSummary\}<\/span>/);
  assert.match(editorStyles, /text-overflow: ellipsis; white-space: nowrap;/);
  assert.match(editor, /<Popover className="customer-document-discount-popover" placement="top end"/);
  assert.match(editor, /<Dialog aria-label="Discount details">/);
  assert.match(editor, /<label>Type\{typeSelector\}<\/label>\{detailFields\}/);
  assert.match(editorStyles, /transition: d 420ms cubic-bezier/);
  assert.match(editorStyles, /d: path\("M3 5 L8 10 L13 5"\)/);
  assert.match(editorStyles, /\.customer-document-discount-summary\.has-discount \.customer-document-discount-arrow path \{ d: path\("M3 5 L8 10 L13 5"\); \}/);
  assert.match(editor, /<path d="M3 8 L8 8 L13 8"/);
  assert.match(editorStyles, /prefers-reduced-motion: reduce/);
  assert.match(editorStyles, /@media \(hover: none\)/);
  assert.match(editor, /disabled=\{disabled\} onChange/g);
  assert.match(editorStyles, /\.is-inline\.is-active\s*\{ min-width: min\(100%, 260px\);/);
  assert.match(editorStyles, /width: min\(320px, calc\(100vw - 24px\)\)/);
});

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

test("discount editor uses the shared Dropdown within the server-backed create pricing hierarchy", () => {
  assert.match(editor, /import \{ Dropdown \}/);
  assert.match(editor, /<Dropdown aria-label="Discount type" disabled=\{disabled\}/);
  assert.match(editor, /<option value="percentage">Percentage<\/option>/);
  assert.match(editor, /<option value="fixed">Fixed amount<\/option>/);
  assert.match(editor, /required minLength="2" maxLength="500"/);
  assert.match(create, /readCustomerDocumentProfile/);
  assert.match(create, /<CustomerDocumentDiscountEditor[\s\S]*inline[\s\S]*customerDiscountControl=\{customerDiscountControl\}/);
  assert.match(create, /customerDiscountControl=\{customerDiscountControl\}/);
  assert.match(createForm, /discountControl: customerDiscountControl/);
  assert.match(createParts, /<WorkorderPricingFooter[\s\S]*discountControl=\{discountControl\}/);
  const footer = readFileSync(new URL("../../components/workorders/WorkorderPricingFooter.jsx", import.meta.url), "utf8");
  assert.match(footer, /Parts & labor[\s\S]*\{discountControl[\s\S]*Tax[\s\S]*Total/);
  assert.doesNotMatch(createParts, /Preview required/);
  assert.match(create, /projection=\{customerProjection\}/);
});
