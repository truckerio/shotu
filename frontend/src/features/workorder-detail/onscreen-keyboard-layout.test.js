import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../../main.jsx", import.meta.url), "utf8");
const root = readFileSync(new URL("../../components/layout/OnscreenKeyboardRoot.jsx", import.meta.url), "utf8");
const createPage = readFileSync(new URL("../create-workorder/CreateWorkorderPage.jsx", import.meta.url), "utf8");
const keyboardHook = readFileSync(new URL("../../hooks/useOnscreenKeyboard.js", import.meta.url), "utf8");
const visibilityHook = readFileSync(new URL("../../hooks/useFocusedFieldVisibility.js", import.meta.url), "utf8");
const keyboardCss = readFileSync(new URL("../../styles/onscreen-keyboard.css", import.meta.url), "utf8");

test("authenticated pages publish one shared on-screen keyboard viewport contract", () => {
  assert.match(main, /<OnscreenKeyboardRoot>/);
  assert.match(root, /useOnscreenKeyboard\(\)/);
  assert.match(keyboardHook, /root\.dataset\.onscreenKeyboard/);
  assert.match(keyboardHook, /--onscreen-keyboard-viewport-height/);
  assert.match(keyboardHook, /useFocusedFieldVisibility/);
  assert.match(keyboardHook, /margin: 32/);
});

test("focus changes while the keyboard stays open reveal the active nested field", () => {
  assert.match(visibilityHook, /nearestScrollableAncestor/);
  assert.match(visibilityHook, /window\.addEventListener\("focusin"/);
  assert.match(visibilityHook, /window\.visualViewport\?\.addEventListener\("resize"/);
  assert.match(visibilityHook, /element\.scrollIntoView/);
  assert.match(visibilityHook, /block: "center"/);
  assert.match(visibilityHook, /for \(const delay of \[160, 420\]\)/);
});

test("Create keyboard mode covers tablets instead of being gated to phone width", () => {
  assert.match(createPage, /const keyboardOpen = viewport\.keyboardOpen;/);
  assert.doesNotMatch(createPage, /const keyboardOpen = Boolean\(isPhone && viewport\.keyboardOpen\)/);
  assert.match(createPage, /useFocusedFieldVisibility\(\{[\s\S]*enabled: true,/);
});

test("fixed dialogs follow the visual viewport and mobile navigation clears the typing area", () => {
  assert.match(keyboardCss, /@media \(max-width:\s*1180px\)/);
  assert.match(keyboardCss, /--onscreen-keyboard-viewport-height/);
  assert.match(keyboardCss, /\.account-modal-overlay/);
  assert.match(keyboardCss, /\.admin-modal-backdrop/);
  assert.match(keyboardCss, /\.modal-backdrop/);
  assert.match(keyboardCss, /\.admin-mobile-nav, \.mobile-jumpbar/);
  assert.match(keyboardCss, /scroll-margin-block: 32px/);
  assert.match(keyboardCss, /scroll-padding-block: 32px 48px/);
});
