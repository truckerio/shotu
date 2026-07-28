import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL("./LoginPage.jsx", import.meta.url);
const cssUrl = new URL("./auth.css", import.meta.url);

test("login exposes visual viewport keyboard state and keyboard action hints", async () => {
  const source = await readFile(componentUrl, "utf8");

  assert.match(source, /useVisualViewport/);
  assert.match(source, /data-keyboard-open=\{keyboardOpen \? "true" : "false"\}/);
  assert.match(source, /enterKeyHint="next"/);
  assert.match(source, /enterKeyHint="done"/);
  assert.doesNotMatch(source, /autoFocus/);
});

test("mobile login centers closed and becomes keyboard-scrollable when open", async () => {
  const css = await readFile(cssUrl, "utf8");
  const mobileRules = css.slice(css.indexOf("@media (max-width: 520px)"));

  assert.match(mobileRules, /\.auth-shell\s*\{[\s\S]*place-items: center;/);
  assert.match(mobileRules, /\.auth-shell\.auth-shell--keyboard-open\s*\{[\s\S]*align-content: start;[\s\S]*overflow-y: auto;/);
  assert.match(mobileRules, /height: var\(--auth-visual-viewport-height, 100dvh\);/);
  assert.match(css, /\.auth-form input\s*\{[\s\S]*min-height: 44px;/);
  assert.match(css, /\.auth-submit,[\s\S]*min-height: 44px;/);
  assert.match(css, /overflow-x: hidden;/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});
