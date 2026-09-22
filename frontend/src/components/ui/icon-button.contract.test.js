import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./IconButton.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./icon-button.css", import.meta.url), "utf8");

test("shared icon button owns accessible icon-only actions", () => {
  assert.match(source, /aria-label=\{label\}/);
  assert.match(source, /title=\{title\}/);
  assert.match(source, /type=\{type\}/);
  assert.match(source, /<Icon aria-hidden="true" focusable="false" \/>/);
  assert.match(css, /\.shared-icon-button\s*\{[^}]*height:\s*44px[^}]*min-width:\s*44px/s);
  assert.match(css, /\.shared-icon-button:focus-visible/);
  assert.match(css, /\.shared-icon-button:disabled/);
  assert.match(css, /\.shared-icon-button\.is-danger/);
});
