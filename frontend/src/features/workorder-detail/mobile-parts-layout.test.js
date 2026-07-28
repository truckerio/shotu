import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../../components/workorders/used-parts-editor.css", import.meta.url),
  "utf8",
);

function phonePartsCss() {
  const marker = "@media (max-width: 640px)";
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, "phone parts breakpoint must exist");
  return css.slice(start);
}

test("phone parts editor removes desktop labels and the legacy delete marker", () => {
  const mobileCss = phonePartsCss();

  assert.match(mobileCss, /\.used-parts-editor\s+\.part-row\.part-row-head\s*\{[^}]*display:\s*none;/s);
  assert.match(mobileCss, /\.used-parts-editor\s+\.used-part-field\s*>\s*span\s*\{[^}]*display:\s*none;/s);
  assert.match(mobileCss, /\.used-parts-editor\s+\.remove-row::before\s*\{[^}]*display:\s*none;/s);
});

test("phone parts row fits 390px and 430px viewports without control overlap", () => {
  const mobileCss = phonePartsCss();

  assert.match(mobileCss, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+124px;/);
  assert.match(mobileCss, /padding:\s*12px 44px 12px 12px;/);
  assert.match(mobileCss, /\.used-parts-editor\s+\.remove-row\s*\{[^}]*position:\s*absolute;[^}]*right:\s*8px;[^}]*width:\s*32px;/s);

  for (const viewportWidth of [390, 430]) {
    const cardWidth = viewportWidth - 48;
    const availableControlWidth = cardWidth - 12 - 44 - 8 - 124;
    assert.ok(availableControlWidth > 150);
  }
});
