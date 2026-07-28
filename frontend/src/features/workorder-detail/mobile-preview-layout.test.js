import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../../components/workorders/workorder-object-page.css", import.meta.url),
  "utf8",
);

function phonePreviewCss() {
  const marker = "@media (max-width: 700px)";
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, "phone workorder breakpoint must exist");
  return css.slice(start);
}

test("phone Preview fills space above navigation and contains document scrolling", () => {
  const mobileCss = phonePreviewCss();

  assert.match(mobileCss, /\.control-panel:has\(>\s*\.workorder-compact-preview\)\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;[^}]*padding-bottom:\s*calc\(75px \+ env\(safe-area-inset-bottom\)\);/s);
  assert.match(mobileCss, /\.control-panel:has\(>\s*\.workorder-compact-preview\)\s*>\s*\.workorder-progressive-stack\s*\{[^}]*display:\s*none;/s);
  assert.match(mobileCss, /\.workorder-compact-preview\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;[^}]*padding:\s*8px 12px 16px;/s);
  assert.match(mobileCss, /\.workorder-compact-preview\s+\.preview-panel\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*overflow:\s*hidden;/s);
  assert.match(mobileCss, /\.workorder-compact-preview\s+\.preview-header\s*\{[^}]*align-items:\s*center;[^}]*flex-direction:\s*row;/s);
  assert.match(mobileCss, /\.workorder-compact-preview\s+\.preview-tool-button\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(mobileCss, /\.workorder-compact-preview\s+\.preview-pane-content\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior-y:\s*contain;/s);
});

test("phone Preview horizontal geometry fits 390px and 430px viewports", () => {
  for (const viewportWidth of [390, 430]) {
    const previewWidth = viewportWidth - 24;
    const panelContentWidth = previewWidth - 22;

    assert.ok(previewWidth > 0);
    assert.ok(panelContentWidth < viewportWidth);
  }
});
