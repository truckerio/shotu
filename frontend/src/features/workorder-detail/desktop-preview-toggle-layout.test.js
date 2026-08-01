import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const styles = fs.readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

test("closed desktop workorder tools collapse without relying on a transition", () => {
  assert.match(
    styles,
    /\.workorder-detail-layout:not\(\.has-preview\)\s*\{[\s\S]*--preview-pane-width:\s*0%\s*!important;[\s\S]*--detail-resizer-width:\s*0px\s*!important;[\s\S]*transition:\s*none;/,
  );
  assert.match(
    styles,
    /\.workorder-detail-layout:not\(\.has-preview\) \.preview-panel\s*\{[\s\S]*opacity:\s*0;[\s\S]*pointer-events:\s*none;[\s\S]*visibility:\s*hidden;/,
  );
  assert.match(
    styles,
    /\.workorder-detail-layout:not\(\.has-preview\) \.control-panel\s*\{[\s\S]*max-width:\s*1280px;[\s\S]*width:\s*100%;/,
  );
});

test("desktop workorder tools tooltip stays beside the header control", () => {
  assert.match(
    styles,
    /\.workorder-detail-page \.detail-context-actions \.preview-pane-toggle::after\s*\{[\s\S]*right:\s*calc\(100% \+ 8px\);[\s\S]*top:\s*50%;[\s\S]*translate\(3px, -50%\)/,
  );
});
