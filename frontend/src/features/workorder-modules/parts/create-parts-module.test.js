import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./CreatePartsModule.jsx", import.meta.url), "utf8");
const priceCell = readFileSync(new URL("./CreateWorkorderPriceCell.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./create-parts-module.css", import.meta.url), "utf8");
const legacyControls = readFileSync(new URL("../../../components/forms/legacy-form-controls.css", import.meta.url), "utf8");
const serializedPicker = readFileSync(new URL("./CreateSerializedUnitPicker.jsx", import.meta.url), "utf8");
const stockDropdown = readFileSync(new URL("./CreateStockDropdown.jsx", import.meta.url), "utf8");
const nestedDropdown = readFileSync(new URL("../../../components/workorders/part-requests/SerializedUnitNestedDropdown.jsx", import.meta.url), "utf8");
const nestedCss = readFileSync(new URL("../../../components/workorders/part-requests/serialized-unit-nested-dropdown.css", import.meta.url), "utf8");
const childPicker = readFileSync(new URL("../../../components/workorders/part-requests/SerializedUnitChildPicker.jsx", import.meta.url), "utf8");
const sharedParts = readFileSync(new URL("../../../components/workorders/WorkorderPartsTable.jsx", import.meta.url), "utf8");
const sharedPartsCss = readFileSync(new URL("../../../components/workorders/workorder-parts-table.css", import.meta.url), "utf8");

test("compact Create Parts hides untouched placeholders behind one editor", () => {
  assert.match(source, /COMPACT_PARTS_QUERY = "\(max-width: 700px\)"/);
  assert.match(source, /createPartRenderIndexes\(parts, editingPartIndex\)/);
  assert.match(source, /!renderIndexes\.length \? \(/);
  assert.match(source, /renderIndexes\.map\(\(index, position\) => renderCompactPart/);
  assert.match(source, /editingPartIndex !== index/);
  assert.match(source, /data-part-editor-index=\{index\}/);
});

test("manual and scanned additions reuse the first hidden blank row", () => {
  assert.match(source, /const targetIndex = firstBlankIndex >= 0 \? firstBlankIndex : parts\.length;/);
  assert.match(source, /if \(firstBlankIndex < 0\) onAdd\(\);/);
  assert.match(source, /function addScannedPart\(unit\)[\s\S]*?setEditingPartIndex\(targetIndex\)/);
  assert.match(source, /catalogPartId: unit\.catalogPartId/);
});

test("compact summaries preserve edit, quantity, repair, and focus behavior", () => {
  assert.match(source, /formatQuantityUnit\(part\.qty, part\.uomCode\)/);
  assert.match(source, /part\.repairOrder \|\| t\("create\.parts\.repairOrderMissing"\)/);
  assert.match(source, /setEditingPartIndex\(index\)/);
  assert.match(source, /summaryRefs\.current\[targetIndex\]/);
  assert.match(source, /querySelector\(`\[data-part-editor-index=/);
  assert.match(source, /invalidCreatePartIndex\(parts\)/);
  assert.match(source, /invalidIndex >= 0\) \{\s*setLaborOpen\(false\);\s*setEditingPartIndex\(invalidIndex\);/s);
  assert.match(source, /onClick=\{\(\) => \{\s*setLaborOpen\(false\);\s*setEditingPartIndex\(index\);/s);
  assert.match(source, /setEditingPartIndex\(-1\);\s*setLaborOpen\(true\);/s);
});

test("compact removal clears the only restored part", () => {
  assert.match(source, /if \(parts\.length <= 1\) \{\s*onChange\(index, \{/s);
  assert.match(source, /catalogPartId:\s*null,[\s\S]*?partNo:\s*"",[\s\S]*?qty:\s*"",[\s\S]*?repairOrder:\s*""/s);
  assert.doesNotMatch(source, /className="create-part-remove"[^>]*disabled=/);
});

test("compact Parts keeps touch geometry and one-column phone editing", () => {
  assert.match(css, /\.create-labor-summary,[\s\S]*?min-height:\s*64px/);
  assert.match(css, /\.create-part-editor-actions \.button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.create-labor-editor \.create-part-repair-field input,[\s\S]*?min-height:\s*44px/s);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.create-part-editor-fields\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(sharedPartsCss, /@media \(max-width: 700px\)[\s\S]*?\.workorder-parts-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.create-stock-dropdown\s*\{[^}]*width:\s*min\(29rem, calc\(100vw - 32px\)\)/s);
  assert.match(css, /\.create-stock-positions input\[type="radio"\]\s*\{[^}]*width:\s*18px/s);
  assert.match(css, /\.create-stock-positions label\s*\{[^}]*min-height:\s*48px/s);
  assert.match(legacyControls, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\),/);
  assert.ok(legacyControls.indexOf('input[type="radio"]') > legacyControls.indexOf(".control-panel input,"));
  assert.match(legacyControls, /input\[type="checkbox"\],[\s\S]*?input\[type="radio"\]\s*\{[^}]*height:\s*18px;[^}]*min-height:\s*0;[^}]*padding:\s*0;[^}]*width:\s*18px;/s);
});

test("desktop retains the existing create Parts grid", () => {
  assert.match(source, /<LegacyCreatePartsEditor/);
  assert.match(source, /<WorkorderPartsTable id="create-known-parts-editor"/);
  assert.match(source, /<WorkorderPartsRow key=\{index\}>/);
  assert.match(source, /<WorkorderPartsActions className="create-parts-actions">/);
  assert.match(sharedParts, /"operational-part-row", "has-quantity-unit"/);
  assert.match(source, /compactLayout \? \(/);
});

test("serialized parent selection opens one shared nested dropdown and derives quantity from selected units", () => {
  assert.match(source, /onOpenSerialPicker\(index\)/);
  assert.match(source, /onSelectedValueOpen=\{part\.catalogPartId \? \(\) => onOpenSerialPicker\(index\) : undefined\}/);
  assert.match(source, /onSelectedValueClose=\{\(\) => onOpenSerialPicker\(-1\)\}/);
  assert.match(source, /selectedValueOpen=\{serialPickerIndex === index\}/);
  assert.doesNotMatch(source, /Choose serial numbers|Select at least one exact serial number/);
  assert.doesNotMatch(css, /create-serial-selection/);
  assert.match(source, /<CreateSerializedUnitPicker[\s\S]*open=\{active\}/);
  assert.match(source, /quantityReadOnly=\{createPartRequiresSerializedUnits\(part\)\}/);
  assert.match(source, /unitReadOnly=\{createPartRequiresSerializedUnits\(part\)\}/);
  assert.match(serializedPicker, /serializedSelectionPatch\(units, selectedIdsRef\.current\)/);
  assert.match(serializedPicker, /setSelectedIds\(new Set\(nextIds\)\)/);
  assert.match(serializedPicker, /setUnits\(\[\]\);[\s\S]*setLoading\(true\)/);
  assert.match(source, /onReplaceSerializedUnits/);
  assert.match(source, /serializedUnitSlots\(parts, index\)/);
  assert.match(source, /serializedUnitIdsOutsidePart\(parts, index\)/);
  assert.match(serializedPicker, /<SerializedUnitNestedDropdown/);
  assert.match(serializedPicker, /autoFocusSearch=\{false\}/);
  assert.match(serializedPicker, /onConfirm=\{commitSelection\}/);
  assert.match(serializedPicker, /selectedIdsRef\.current/);
  assert.match(serializedPicker, /showConfirmCount=\{false\}/);
  assert.match(source, /className="create-part-serial-summary"/);
  assert.match(source, /serializedPartSummary\(part, locale\)/);
  assert.match(nestedDropdown, /<SerializedUnitChildPicker/);
  assert.match(nestedDropdown, /type="search"/);
  assert.match(nestedDropdown, /event\.key === "Escape"/);
  assert.match(nestedDropdown, /selectedUnitIds instanceof Set/);
  assert.match(childPicker, /<Checkbox/);
  assert.match(childPicker, /import \{ Checkbox \}/);
  assert.match(childPicker, /onSelectionChange\?\.\(new Set\(next\)\)/);
  assert.match(css, /\.create-part-identity-field \.serialized-unit-nested-dropdown\s*\{[^}]*left:\s*calc\(100% \+ 8px\)/s);
  assert.match(nestedCss, /\.serialized-unit-nested-dropdown\s*\{[^}]*position:\s*absolute/s);
  assert.match(nestedCss, /max-height:\s*min\(34rem, calc\(100dvh - 32px\)\)/);
});

test("quantity and bulk parts choose a position while batch allocation stays automatic", () => {
  assert.match(source, /<CreateStockDropdown/);
  assert.match(stockDropdown, /legend>Pick from<\/legend>/);
  assert.match(stockDropdown, /selling-policy\?locationId=/);
  assert.match(stockDropdown, /Automatic · oldest first/);
  assert.match(stockDropdown, /allocationQuantity/);
  assert.doesNotMatch(stockDropdown, /name=\{`source-batch-/);
  assert.match(stockDropdown, /batchCoverageMissing/);
  assert.match(stockDropdown, /Review this position in Inventory/);
  assert.match(stockDropdown, /disabled=\{requiresSourcePosition && \(!selectedPosition \|\| batchCoverageMissing\)\}/);
  assert.match(css, /\.create-stock-batch-allocation\s*\{[^}]*min-height:\s*44px/s);
});

test("catalog and scanned selections carry descriptions into each Repair order", () => {
  assert.match(source, /repairOrder:\s*repairOrderAfterCatalogSelection\(part\.repairOrder, catalogPart, part\.catalogPartId\)/);
  assert.equal((source.match(/repairOrder: repairOrderAfterCatalogSelection\("", unit\)/g) || []).length, 2);
  assert.doesNotMatch(source, /repairOrderAfterNestedSelection/);
});

test("request and scan actions align with the visible Parts heading", () => {
  assert.match(source, /className="create-parts-header-actions"[\s\S]*\{requestPartButton\}[\s\S]*<CreatePartScanner/);
  assert.match(source, /headerAction=\{partsHeaderActions\}/);
  assert.doesNotMatch(source, /headerAction=\{compactLayout \? null : partsHelp\}/);
  assert.match(css, /\.create-parts-header-actions\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.create-parts-card \.workorder-section-panel-heading\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.create-parts-card \.workorder-section-panel-heading\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.create-parts-header-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\) auto/s);
});

test("Add line remains below numbered rows and pricing totals remain at the section bottom", () => {
  const tableEnd = source.indexOf("</WorkorderPartsTable>");
  const addLine = source.indexOf('t("create.parts.add")', tableEnd);
  const pricingFooter = source.lastIndexOf('className="create-pricing-footer"');
  assert.ok(tableEnd >= 0 && addLine > tableEnd);
  assert.ok(pricingFooter > addLine);
  assert.doesNotMatch(source, /<WorkorderPartsActions className="create-parts-actions">\s*\{requestPartButton\}/s);
});

test("unlinked pricing uses a quiet field and row price cells omit inline totals", () => {
  assert.match(priceCell, /aria-label="Price" className="create-price-empty-field" disabled placeholder="Price"/);
  assert.doesNotMatch(priceCell, /className="create-price-label"/);
  assert.doesNotMatch(priceCell, /Unpriced until received and linked to exact inventory/);
  assert.doesNotMatch(priceCell, /<span>Total/);
  assert.match(priceCell, /className="create-inline-price-control"/);
  assert.doesNotMatch(priceCell, /FCFS/);
});

test("office and admin Create Parts expose controlled server-preview pricing in desktop and compact layouts", () => {
  assert.match(source, /pricing\?\.enabled === true/);
  assert.match(source, /WORKORDER_PARTS_COLUMNS\.PRICE/);
  assert.match(source, /<CreateLaborPriceCell/);
  assert.match(source, /<CreatePartPriceCell/);
  assert.match(source, /selection=\{part\.priceSelection\}/);
  assert.match(source, /eligible=\{partHasExactInventorySource\(part\)\}/);
  assert.match(source, /purchaseRequested:true,[^}]*priceSelection:""/);
  assert.match(source, /onChange=\{\(selection\) => onChange\(index, \{ priceSelection: selection, customUnitPrice: "" \}\)\}/);
  assert.match(source, /onCustomUnitPriceChange=\{\(customUnitPrice\) => onChange\(index, \{ customUnitPrice \}\)\}/);
  assert.match(priceCell, /priceOptionLabel\(internalPrice, "internal price"\)/);
  assert.match(priceCell, /priceOptionLabel\(sellingPrice, "selling price"\)/);
  assert.match(priceCell, /aria-label="Workorder unit price"/);
  assert.match(priceCell, /className="create-price-source-menu"/);
  assert.doesNotMatch(priceCell, /Change price/);
  assert.match(source, /<CreatePricingTotal pricing=\{pricing\}/);
  assert.match(source, /summary\?\.status === "complete"[\s\S]*formatWorkorderMoney\(summary\.grandTotal, summary\.currency\)/);
  assert.match(css, /\.create-inline-price-control\s*\{[^}]*min-height:\s*40px/s);
  assert.match(css, /\.create-inline-price-control\s*\{[^}]*position:\s*relative/s);
  assert.match(css, /\.create-price-source-menu\s*\{[^}]*inset:\s*0[^}]*position:\s*absolute[^}]*width:\s*100%/s);
  assert.match(css, /\.create-workorder-price-cell \.create-price-source-menu \.dropdown-select-trigger\s*\{[^}]*justify-content:\s*flex-end[^}]*width:\s*100%/s);
  assert.match(css, /\.create-price-source-menu \.dropdown-select-chevron\s*\{[^}]*pointer-events:\s*auto[^}]*width:\s*36px/s);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.create-inline-price-control\s*\{[^}]*min-height:\s*44px/s);
});
