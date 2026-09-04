import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./CreatePartsModule.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./create-parts-module.css", import.meta.url), "utf8");
const serializedPicker = readFileSync(new URL("./CreateSerializedUnitPicker.jsx", import.meta.url), "utf8");
const nestedDropdown = readFileSync(new URL("../../../components/workorders/part-requests/SerializedUnitNestedDropdown.jsx", import.meta.url), "utf8");
const nestedCss = readFileSync(new URL("../../../components/workorders/part-requests/serialized-unit-nested-dropdown.css", import.meta.url), "utf8");
const childPicker = readFileSync(new URL("../../../components/workorders/part-requests/SerializedUnitChildPicker.jsx", import.meta.url), "utf8");

test("compact Create Parts hides untouched placeholders behind one editor", () => {
  assert.match(source, /COMPACT_PARTS_QUERY = "\(max-width: 1024px\)"/);
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
  assert.match(css, /\.create-parts-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
});

test("desktop retains the existing create Parts grid", () => {
  assert.match(source, /<LegacyCreatePartsEditor/);
  assert.match(source, /className="operational-part-row has-quantity-unit"/);
  assert.match(source, /compactLayout \? \(/);
});

test("serialized parent selection opens one shared nested dropdown and derives quantity from selected units", () => {
  assert.match(source, /onOpenSerialPicker\(catalogPart\.inventory\?\.serializationRequired === true \? index : -1\)/);
  assert.match(source, /onSelectedValueOpen=\{createPartRequiresSerializedUnits\(part\) \? \(\) => onOpenSerialPicker\(index\) : undefined\}/);
  assert.match(source, /onSelectedValueClose=\{\(\) => onOpenSerialPicker\(-1\)\}/);
  assert.match(source, /selectedValueOpen=\{serialPickerIndex === index\}/);
  assert.doesNotMatch(source, /Choose serial numbers|Select at least one exact serial number/);
  assert.doesNotMatch(css, /create-serial-selection/);
  assert.match(source, /<CreateSerializedUnitPicker[\s\S]*open=\{active\}/);
  assert.match(source, /quantityReadOnly=\{createPartRequiresSerializedUnits\(part\)\}/);
  assert.match(source, /unitReadOnly=\{createPartRequiresSerializedUnits\(part\)\}/);
  assert.match(serializedPicker, /serializedSelectionPatch\(units, nextIds\)/);
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
  assert.match(childPicker, /type="checkbox"/);
  assert.match(childPicker, /onSelectionChange\?\.\(new Set\(next\)\)/);
  assert.match(css, /\.create-part-identity-field \.serialized-unit-nested-dropdown\s*\{[^}]*left:\s*calc\(100% \+ 8px\)/s);
  assert.match(nestedCss, /\.serialized-unit-nested-dropdown\s*\{[^}]*position:\s*absolute/s);
  assert.match(nestedCss, /max-height:\s*min\(34rem, calc\(100dvh - 32px\)\)/);
});

test("catalog selection never writes the description into Repair order", () => {
  assert.match(source, /function repairOrderAfterNestedSelection/);
  assert.match(source, /repairOrder:\s*repairOrderAfterNestedSelection\(part\.repairOrder, catalogPart\)/);
  assert.match(source, /current\.localeCompare\(description/);
  assert.doesNotMatch(source, /repairOrderAfterCatalogSelection/);
});

test("help aligns with the visible Parts heading in both layouts", () => {
  assert.match(source, /headerAction=\{compactLayout \? null : partsHelp\}/);
  assert.match(source, /className="create-parts-group-heading has-help"[\s\S]*create-parts-labor-title[\s\S]*\{partsHelp\}/);
  assert.match(css, /\.create-parts-group-heading\.has-help\s*\{[^}]*align-items:\s*center/s);
});
