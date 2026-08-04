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

test("shared parts editor uses one text remove action without duplicate icons", () => {
  assert.match(editor, />Remove<\/button>/);
  assert.doesNotMatch(editor, /Trash01/);
  assert.doesNotMatch(globalCss, /\.remove-row::before/);
  assert.doesNotMatch(css, /\.remove-row::before/);
});

test("repair order uses one visible column heading and an accessible row control", () => {
  assert.match(editor, /<span>Repair order<\/span>/);
  assert.doesNotMatch(editor, /<span className="used-part-label">Repair order<\/span>/);
  assert.match(editor, /aria-label=\{`Repair order \$\{index \+ 1\}`\}/);
  assert.match(editor, /placeholder="Describe repair for this part"/);
  assert.doesNotMatch(editor, /aria-label=\{`Work performed \$\{index \+ 1\}`\}/);
  assert.match(globalCss, /\.used-part-field\s*>\s*\.used-part-label\s*\{[^}]*display:\s*none;/s);
  assert.doesNotMatch(globalCss, /\.used-part-field\s*>\s*span\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /\.used-parts-editor\s+\.used-part-repair\s+\.narrative-field-control\s*\{[^}]*min-height:\s*34px;[^}]*padding:\s*6px 8px;/s);
});

test("phone parts editor removes desktop labels", () => {
  const mobileCss = phonePartsCss();

  assert.match(mobileCss, /\.used-parts-editor\s+\.part-row\.part-row-head\s*\{[^}]*display:\s*none;/s);
  assert.match(mobileCss, /\.used-parts-editor\s+\.used-part-field\s*>\s*\.used-part-label\s*\{[^}]*display:\s*none;/s);
  assert.match(mobileCss, /\.used-parts-editor\s+\.used-part-repair\s+\.narrative-field-control\s*\{[^}]*min-height:\s*44px;/s);
});

test("phone parts row fits 390px and 430px viewports without control overlap", () => {
  const mobileCss = phonePartsCss();

  assert.match(mobileCss, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+124px;/);
  assert.match(mobileCss, /padding:\s*12px;/);
  assert.match(mobileCss, /\.used-parts-editor\s+\.remove-row\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*min-width:\s*72px;/s);

  for (const viewportWidth of [390, 430]) {
    const cardWidth = viewportWidth - 48;
    const availableControlWidth = cardWidth - 24 - 8 - 124;
    assert.ok(availableControlWidth > 150);
  }
});
