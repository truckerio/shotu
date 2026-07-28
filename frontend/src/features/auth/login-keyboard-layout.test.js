import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL("./LoginPage.jsx", import.meta.url);
const cssUrl = new URL("./auth.css", import.meta.url);

test("login exposes visual viewport keyboard state and keyboard action hints", async () => {
  const source = await readFile(componentUrl, "utf8");

  assert.match(source, /useVisualViewport/);
  assert.match(source, /useFocusedFieldVisibility/);
  assert.match(source, /containerRef:\s*shellRef/);
  assert.match(source, /ref=\{shellRef\}/);
  assert.match(source, /data-keyboard-open=\{keyboardOpen \? "true" : "false"\}/);
  assert.match(source, /enterKeyHint="next"/);
  assert.match(source, /enterKeyHint="done"/);
  assert.doesNotMatch(source, /autoFocus/);
});

test("mobile login centers closed and becomes keyboard-scrollable when open", async () => {
  const css = await readFile(cssUrl, "utf8");
  const mobileRules = css.slice(css.indexOf("@media (max-width: 520px)"));

  assert.match(mobileRules, /\.auth-shell\s*\{[\s\S]*place-items: center;/);
  assert.match(mobileRules, /\.auth-shell\.auth-shell--keyboard-open\s*\{[\s\S]*align-content: start;[\s\S]*inset: var\(--auth-visual-viewport-offset-top, 0px\) 0 auto;[\s\S]*min-height: 0;[\s\S]*overflow-y: auto;[\s\S]*position: fixed;/);
  assert.match(mobileRules, /height: var\(--auth-visual-viewport-height, 100dvh\);/);
  assert.match(css, /\.auth-form input\s*\{[\s\S]*min-height: 44px;/);
  assert.match(css, /\.auth-submit,[\s\S]*min-height: 44px;/);
  assert.match(css, /overflow-x: hidden;/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test("short landscape screens use a compact scrollable login layout", async () => {
  const css = await readFile(cssUrl, "utf8");
  const shortRules = css.slice(css.indexOf("@media (max-height: 520px)"));

  assert.match(shortRules, /\.auth-shell\s*\{[\s\S]*align-content:\s*start;[\s\S]*overflow-y:\s*auto;[\s\S]*padding-block:\s*12px;/);
  assert.match(shortRules, /\.auth-panel\s*\{[\s\S]*padding:\s*20px 24px;/);
  assert.match(shortRules, /\.auth-heading\s*\{[\s\S]*margin-bottom:\s*18px;/);
  assert.match(shortRules, /\.auth-form\s*\{[\s\S]*gap:\s*14px;/);
});
