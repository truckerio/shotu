import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./customer-document.css", import.meta.url), "utf8");

test("narrow customer document actions stack and clear the create footer", () => {
  assert.match(css, /@media \(max-width:700px\)[\s\S]*\.customer-document-review-actions\{display:grid;grid-template-columns:minmax\(0,1fr\);gap:8px\}/);
  assert.match(css, /\.customer-document-review-actions \.button\{[^}]*width:100%;[^}]*min-height:44px;[^}]*white-space:normal;[^}]*word-break:normal/);
  assert.match(css, /\.create-workorder-page \.customer-document-review-actions\{padding-bottom:calc\(144px \+ env\(safe-area-inset-bottom\)\)\}/);
});
