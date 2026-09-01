import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./CreatePartsModule.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./create-parts-module.css", import.meta.url), "utf8");

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
