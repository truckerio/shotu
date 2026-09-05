import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editor = readFileSync(
  new URL("../../components/workorders/UsedPartsEditor.jsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../../components/workorders/used-parts-editor.css", import.meta.url),
  "utf8",
);
const globalCss = readFileSync(
  new URL("../../styles.css", import.meta.url),
  "utf8",
);
const sharedParts = readFileSync(
  new URL("../../components/workorders/WorkorderPartsTable.jsx", import.meta.url),
  "utf8",
);
const sharedPartsCss = readFileSync(
  new URL("../../components/workorders/workorder-parts-table.css", import.meta.url),
  "utf8",
);
const operationalCss = readFileSync(
  new URL("../../components/forms/operational-form.css", import.meta.url),
  "utf8",
);
const quantityCss = readFileSync(
  new URL("../../components/forms/quantity-unit-input.css", import.meta.url),
  "utf8",
);

function phonePartsCss() {
  const marker = "@media (max-width: 640px)";
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, "phone parts breakpoint must exist");
  return css.slice(start);
}

test("shared parts editor keeps legacy manual rows immutable without extra evidence labels or remove actions", () => {
  assert.match(editor, /const recordedManualParts = readonlyUsedParts\(parts\)/);
  assert.match(editor, /recordedManualParts\.map\(\(part, index\) => renderRecordedPartRow/);
  assert.doesNotMatch(editor, /parts\.legacyManualEvidence/);
  assert.doesNotMatch(editor, /className="remove-row"/);
  assert.doesNotMatch(editor, /Trash01/);
  assert.doesNotMatch(globalCss, /\.remove-row::before/);
  assert.doesNotMatch(css, /\.remove-row::before/);
});

test("serialized repair order follows the header-free Create table and retains an accessible editable control", () => {
  assert.doesNotMatch(editor, /part-row-head/);
  assert.doesNotMatch(editor, /<span className="used-part-label">\{t\("parts\.repairOrder"\)\}<\/span>/);
  assert.match(editor, /aria-label=\{`\$\{t\("parts\.repairOrder"\)\} \$\{index \+ 2\}`\}/);
  assert.match(editor, /placeholder=\{t\("parts\.describeRepair"\)\}/);
  assert.doesNotMatch(editor, /aria-label=\{`Work performed \$\{index \+ 1\}`\}/);
  assert.match(globalCss, /\.used-part-field\s*>\s*\.used-part-label\s*\{[^}]*display:\s*none;/s);
  assert.doesNotMatch(globalCss, /\.used-part-field\s*>\s*span\s*\{[^}]*display:\s*none;/s);
  assert.match(editor, /<WorkorderPartsRow[\s\S]*?className="used-part-serialized-row"/);
  assert.match(css, /\.used-parts-editor\s+\.used-part-repair\s+\.narrative-field-control\s*\{[^}]*min-height:\s*34px;[^}]*padding:\s*6px 8px;/s);
});

test("serialized part identity uses separate wrapping lines and top-aligned row fields", () => {
  assert.match(editor, /className="used-part-field used-part-serialized-identity"/);
  assert.match(editor, /className="used-part-serialized-serial"/);
  assert.match(editor, /className="used-part-serialized-kind"/);
  assert.match(css, /\.used-parts-editor\s+\.used-part-serialized-row\s*\{[^}]*align-items:\s*start;/s);
  assert.match(css, /\.used-parts-editor\s+\.used-part-serialized-identity\s*\{[^}]*display:\s*grid;[^}]*gap:\s*2px;[^}]*min-width:\s*0;/s);
  assert.match(css, /\.used-parts-editor\s+\.used-part-serialized-identity\s*>\s*strong\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*text-align:\s*left;/s);
  assert.match(css, /\.used-parts-editor\s+\.used-part-serialized-identity\s*>\s*small\s*\{[^}]*display:\s*block;[^}]*overflow-wrap:\s*anywhere;/s);
});

test("detail rows reuse the Create Workorder operational table geometry across lifecycle stages", () => {
  assert.match(editor, /<WorkorderPartsTable className="detail-operational-parts-editor">/);
  assert.match(editor, /<WorkorderPartsRow[\s\S]*?className="used-part-recorded-row"/);
  assert.match(editor, /<WorkorderPartsActions className="used-parts-actions">/);
  assert.match(sharedParts, /"operational-parts-editor"/);
  assert.match(sharedParts, /"operational-part-row", "has-quantity-unit"/);
  assert.match(sharedParts, /"workorder-parts-actions"/);
  assert.match(quantityCss, /\.operational-part-row\.has-quantity-unit\s*\{[^}]*grid-template-columns:\s*24px minmax\(0, 1\.1fr\) minmax\(126px, 0\.85fr\) minmax\(0, 1fr\) 64px;/s);
  assert.match(
    css,
    /\.used-parts-editor\s+\.used-part-serialized-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s,
  );
  assert.match(
    css,
    /\.used-parts-editor\s+\.used-part-serialized-actions\s+\.used-part-serialized-status\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/s,
  );
  assert.match(
    css,
    /\.used-parts-editor\s+\.used-part-serialized-actions\s+\.button\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;/s,
  );
});

test("phone parts editor uses the same shared responsive row and action geometry", () => {
  assert.match(quantityCss, /@container \(max-width: 520px\)[\s\S]*?\.operational-part-row\.has-quantity-unit\s*\{[^}]*grid-template-columns:\s*24px minmax\(0, 1fr\) minmax\(120px, 0\.75fr\) 64px;/s);
  assert.match(sharedPartsCss, /@media \(max-width: 700px\)[\s\S]*?\.workorder-parts-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(css, /@container \(max-width: 520px\)[\s\S]*?\.used-parts-editor \.used-part-repair\s*\{[^}]*grid-column:\s*2 \/ 4;/s);
  assert.match(phonePartsCss(), /\.used-parts-actions \.mechanic-scan-trigger\.is-table-action\s*\{[^}]*width:\s*44px;/s);
});

test("used-parts intake and labor stay compact without hiding accessible names", () => {
  assert.match(editor, /<WorkorderPartsRow className="used-part-intake-row" ref=\{intakeRowRef\}>/);
  assert.match(editor, /inputAriaLabel=\{t\("parts\.numberOrDescription"\)\}/);
  assert.doesNotMatch(editor, /part-row-head/);
  assert.match(editor, /<WorkorderPartsRow className="used-part-labor-row" aria-label=\{t\("parts\.laborHours"\)\}>\s*<strong>1<\/strong>/);
  assert.match(editor, /<WorkorderPartsActions className="used-parts-actions">[\s\S]*?t\("create\.parts\.add"\)[\s\S]*?\{serializedToolbar\}/);
  assert.match(editor, /function resetIntakeRow\(\)[\s\S]*?setCatalogQuery\(""\)/);
});

test("phone parts row fits 390px and 430px viewports without control overlap", () => {
  assert.match(operationalCss, /@media \(max-width: 700px\)[\s\S]*?\.operational-part-row\s*\{[^}]*grid-template-columns:\s*24px minmax\(0, 1fr\) 70px;/s);
  assert.match(quantityCss, /\.operational-part-row\.has-quantity-unit\s*\{[^}]*min-width:\s*0;/s);
  assert.match(sharedPartsCss, /\.workorder-parts-actions > \.button\s*\{[^}]*justify-content:\s*center;[^}]*width:\s*100%;/s);
});
