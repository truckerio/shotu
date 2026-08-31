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

function phonePartsCss() {
  const marker = "@media (max-width: 640px)";
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, "phone parts breakpoint must exist");
  return css.slice(start);
}

test("shared parts editor keeps legacy manual evidence immutable without remove actions", () => {
  assert.match(editor, /readonlyUsedParts\(parts\)\.map/);
  assert.match(editor, /parts\.legacyManualEvidence/);
  assert.doesNotMatch(editor, /className="remove-row"/);
  assert.doesNotMatch(editor, /Trash01/);
  assert.doesNotMatch(globalCss, /\.remove-row::before/);
  assert.doesNotMatch(css, /\.remove-row::before/);
});

test("serialized repair order uses one visible heading and accessible editable control", () => {
  assert.match(editor, /<span>\{t\("parts\.repairOrder"\)\}<\/span>/);
  assert.doesNotMatch(editor, /<span className="used-part-label">\{t\("parts\.repairOrder"\)\}<\/span>/);
  assert.match(editor, /aria-label=\{`\$\{t\("parts\.repairOrder"\)\} \$\{index \+ 2\}`\}/);
  assert.match(editor, /placeholder=\{t\("parts\.describeRepair"\)\}/);
  assert.doesNotMatch(editor, /aria-label=\{`Work performed \$\{index \+ 1\}`\}/);
  assert.match(globalCss, /\.used-part-field\s*>\s*\.used-part-label\s*\{[^}]*display:\s*none;/s);
  assert.doesNotMatch(globalCss, /\.used-part-field\s*>\s*span\s*\{[^}]*display:\s*none;/s);
  assert.match(editor, /className="part-row used-part-serialized-row"/);
  assert.match(css, /\.used-parts-editor\s+\.used-part-repair\s+\.narrative-field-control\s*\{[^}]*min-height:\s*34px;[^}]*padding:\s*6px 8px;/s);
});

test("serialized part identity uses separate wrapping lines and top-aligned row fields", () => {
  assert.match(editor, /className="used-part-field used-part-serialized-identity"/);
  assert.match(editor, /className="used-part-serialized-serial"/);
  assert.match(editor, /className="used-part-serialized-kind"/);
  assert.match(css, /\.used-parts-editor\s+\.used-part-serialized-row\s*\{[^}]*align-items:\s*start;[^}]*column-gap:\s*12px;/s);
  assert.match(css, /\.used-parts-editor\s+\.used-part-serialized-identity\s*\{[^}]*display:\s*grid;[^}]*gap:\s*2px;[^}]*min-width:\s*0;/s);
  assert.match(css, /\.used-parts-editor\s+\.used-part-serialized-identity\s*>\s*strong\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*text-align:\s*left;/s);
  assert.match(css, /\.used-parts-editor\s+\.used-part-serialized-identity\s*>\s*small\s*\{[^}]*display:\s*block;[^}]*overflow-wrap:\s*anywhere;/s);
});

test("phone parts editor removes desktop labels", () => {
  const mobileCss = phonePartsCss();

  assert.match(mobileCss, /\.used-parts-editor\s+\.part-row\.part-row-head\s*\{[^}]*display:\s*none;/s);
  assert.match(mobileCss, /\.used-parts-editor\s+\.used-part-field\s*>\s*\.used-part-label\s*\{[^}]*display:\s*none;/s);
  assert.match(mobileCss, /\.used-parts-editor\s+\.used-part-repair\s+\.narrative-field-control\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(mobileCss, /\.used-parts-editor\s+\.used-part-serialized-status\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/s);
  assert.match(mobileCss, /\.used-parts-editor\s+\.used-part-serialized-actions\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/s);
  assert.match(mobileCss, /\.used-parts-editor\s+\.used-part-serialized-actions\s+\.button\s*\{[^}]*flex:\s*1 1 140px;/s);
  assert.match(mobileCss, /\.used-part-serialized-confirmation\s*\{[^}]*margin-left:\s*0;/s);
});

test("phone parts row fits 390px and 430px viewports without control overlap", () => {
  const mobileCss = phonePartsCss();

  assert.match(mobileCss, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+124px;/);
  assert.match(mobileCss, /padding:\s*12px;/);
  assert.match(mobileCss, /\.used-parts-editor\s+\.used-part-serialized-actions\s+\.button\s*\{[^}]*flex:\s*1 1 140px;/s);

  for (const viewportWidth of [390, 430]) {
    const cardWidth = viewportWidth - 48;
    const availableControlWidth = cardWidth - 24 - 8 - 124;
    assert.ok(availableControlWidth > 150);
  }
});
