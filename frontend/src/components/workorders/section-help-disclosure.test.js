import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const component = readSource("./SectionHelpDisclosure.jsx");
const styles = readSource("./section-help-disclosure.css");

test("section help is an explicit dismissible disclosure", () => {
  assert.match(component, /<button[\s\S]*type="button"[\s\S]*aria-controls=\{panelId\}[\s\S]*aria-expanded=\{open\}/);
  assert.match(component, /event\.key !== "Escape"/);
  assert.match(component, /triggerRef\.current\?\.focus\(\)/);
  assert.match(component, /document\.addEventListener\("pointerdown", closeOutside\)/);
  assert.match(component, /role="note" hidden=\{!open\}/);
});

test("section help is touch-safe and viewport-contained", () => {
  assert.match(styles, /height: 40px/);
  assert.match(styles, /width: 40px/);
  assert.match(styles, /max-height: min\(320px, calc\(100dvh - 32px\)\)/);
  assert.match(styles, /width: min\(320px, calc\(100vw - 32px\)\)/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*height: 44px[\s\S]*width: 44px/);
  assert.match(styles, /:focus-visible/);
  assert.doesNotMatch(styles, /#d1e9ff|#1570ef/);
  assert.match(styles, /background: transparent[\s\S]*border: 1px solid transparent/);
  assert.match(styles, /:focus-visible[\s\S]*background: #f2f4f7[\s\S]*border-color: #d0d5dd/);
  assert.match(styles, /@media \(hover: hover\)[\s\S]*:hover[\s\S]*background: #f2f4f7[\s\S]*border-color: #d0d5dd/);
  assert.match(styles, /transition: background-color 140ms ease/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/);
});
