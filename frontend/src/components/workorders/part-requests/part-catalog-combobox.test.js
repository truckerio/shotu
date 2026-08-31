import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { catalogPopupWidth, catalogSearchPlan } from "./part-catalog-popup-model.js";

const source = readFileSync(new URL("./PartCatalogCombobox.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./part-catalog-combobox.css", import.meta.url), "utf8");

test("catalog lookup stays deterministic, bounded, debounced, and cancellable", () => {
  assert.match(source, /SEARCH_DELAY_MS = 250/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /requestSequence\.current/);
  assert.match(source, /catalogEndpoint = "\/api\/parts-helper\/catalog"/);
  assert.match(source, /resultLimit = 8/);
  assert.match(source, /catalogSearchPlan/);
  assert.match(source, /limit: String\(boundedResultLimit\)/);
  assert.match(source, /purpose = "issue"/);
  assert.match(source, /purpose,/);
  assert.match(source, /api\(`\$\{catalogEndpoint\}\?\$\{params\}`/);
  assert.doesNotMatch(source, /parts-helper\/identify|live-prices/);
});

test("catalog popup presents locally backed identities as our inventory", () => {
  assert.match(source, /popupAriaLabel = "Our inventory"/);
  assert.match(source, /sourceLabel/);
  assert.match(source, /parts\.ourInventory/);
  assert.match(source, /parts\.masterCatalog/);
  assert.match(source, /parts\.searchingOurInventory/);
  assert.doesNotMatch(source, /part\.source === "odoo"/);
  assert.doesNotMatch(source, />Odoo</);
});

test("master matching uses a neutral master catalog label", () => {
  assert.match(source, /const masterMatch = purpose === "master_match"/);
  assert.match(source, /parts\.masterCatalog/);
  assert.match(source, /parts\.searchingMasterCatalog/);
  assert.match(source, /parts\.noMasterCatalogParts/);
  assert.match(source, /catalogPartDetails\(part, t, purpose\)/);
});

test("every catalog consumer declares its search purpose", () => {
  const consumers = {
    usedParts: readFileSync(new URL("../UsedPartsEditor.jsx", import.meta.url), "utf8"),
    mechanicRequest: readFileSync(new URL("../MechanicPartRequestForm.jsx", import.meta.url), "utf8"),
    officeApproved: readFileSync(new URL("./OfficePartComposer.jsx", import.meta.url), "utf8"),
    officeRequest: readFileSync(new URL("./OfficeRequestCard.jsx", import.meta.url), "utf8"),
    createParts: readFileSync(new URL("../../../features/workorder-modules/parts/CreatePartsModule.jsx", import.meta.url), "utf8"),
    inventoryCount: readFileSync(new URL("../../../features/inventory/InventoryCountImportPanel.jsx", import.meta.url), "utf8"),
  };

  for (const sourceText of [consumers.usedParts, consumers.createParts]) {
    assert.match(sourceText, /<PartCatalogCombobox[\s\S]*?purpose="issue"/);
  }
  for (const sourceText of [consumers.mechanicRequest, consumers.officeRequest, consumers.officeApproved]) {
    assert.match(sourceText, /<PartCatalogCombobox[\s\S]*?purpose="request"/);
  }
  assert.match(consumers.inventoryCount, /<PartCatalogCombobox[\s\S]*?purpose="master_match"/);
  assert.match(consumers.inventoryCount, /catalogEndpoint="\/api\/office\/inventory\/catalog"/);
});

test("automatic catalog evidence produces one bounded ranked lookup plan", () => {
  assert.deepEqual(catalogSearchPlan({ value: "OF-001", suggestionQuery: "Engine Oil Filter", resultLimit: 50 }), {
    query: "Engine Oil Filter",
    limit: 12,
  });
  assert.deepEqual(catalogSearchPlan({ value: "LF16233", suggestionQuery: "", resultLimit: 0 }), {
    query: "LF16233",
    limit: 8,
  });
});

test("catalog lookup can reuse the accessible combobox with another ranked endpoint", () => {
  assert.match(source, /catalogEndpoint/);
  assert.match(source, /resultLimit/);
  assert.match(source, /popupAriaLabel/);
  assert.match(source, /suggestionQuery/);
  assert.match(source, /aria-label=\{locale === "en" \? popupAriaLabel : sourceLabel\}/);
});

test("saved part values stay closed until the user interacts with the combobox", () => {
  assert.match(source, /const \[interacting, setInteracting\] = useState\(false\)/);
  assert.match(source, /if \(!interacting \|\| disabled/);
  assert.match(source, /onFocus=\{\(\) => \{[\s\S]*?setInteracting\(true\)/);
  assert.match(source, /onChange=\{\(event\) => \{[\s\S]*?setInteracting\(true\)/);
  assert.match(source, /closeFromOutside[\s\S]*?setInteracting\(false\)/);
  assert.match(source, /event\.key === "Escape"[\s\S]*?setInteracting\(false\)/);
  assert.match(source, /event\.key === "Tab"[\s\S]*?setInteracting\(false\)/);
});

test("combobox exposes listbox semantics and complete keyboard selection", () => {
  assert.match(source, /role="combobox"/);
  assert.match(source, /aria-autocomplete="list"/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /event\.key === "Tab"/);
  assert.match(source, /"ArrowDown", "ArrowUp", "Enter"/);
  assert.match(source, /\["ArrowDown", "ArrowUp", "Enter"\][\s\S]*?event\.stopPropagation\(\)/);
  assert.match(source, /onClick=\{\(\) => select\(part\)\}/);
  assert.match(source, /scrollIntoView/);
});

test("manual entry remains available for empty, unmatched, and failed lookup", () => {
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /parts\.noCompanyParts/);
  assert.match(source, /parts\.noCatalogMatchFind/);
  assert.match(source, /parts\.noCatalogMatch/);
  assert.match(source, /t\("parts\.lookupUnavailable"\)/);
  assert.match(source, /onChange\(event\.target\.value\)/);
});

test("catalog popup stays readable beyond the narrow input column", () => {
  assert.match(styles, /\.part-catalog-popup\s*\{[\s\S]*?right:\s*auto;/);
  assert.match(styles, /width:\s*var\(--part-catalog-popup-width, min\(480px, calc\(100vw - 32px\)\)\);/);
  assert.match(styles, /max-width:\s*calc\(100vw - 32px\);/);
  assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
  assert.match(styles, /\.part-catalog-popup \.part-catalog-option-heading strong\s*\{[^}]*text-align:\s*left;/s);
  assert.match(styles, /overflow-wrap:\s*anywhere;/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?max-width:\s*calc\(100vw - 24px\);/);
});

test("catalog popup follows the parts row and stays inside the viewport", () => {
  assert.equal(catalogPopupWidth({ anchorLeft: 108, anchorWidth: 396, rowEnd: 1236, viewportWidth: 1498 }), 1128);
  assert.equal(catalogPopupWidth({ anchorLeft: 80, anchorWidth: 220, rowEnd: 500, viewportWidth: 390 }), 294);
  assert.equal(catalogPopupWidth({ anchorLeft: 100, anchorWidth: 360, rowEnd: 300, viewportWidth: 1200 }), 360);
  assert.match(source, /closest\("\.part-row, \.operational-part-row"\)/);
  assert.match(source, /\.used-part-repair, input\[aria-label\^='Repair order'\]/);
  assert.match(source, /new ResizeObserver\(measure\)/);
});
