import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const button = readFileSync(new URL("../ui/Button.jsx", import.meta.url), "utf8");
const controls = readFileSync(new URL("./legacy-form-controls.css", import.meta.url), "utf8");
const searchControls = readFileSync(new URL("./search-controls.css", import.meta.url), "utf8");
const foundation = readFileSync(new URL("../../styles/foundation.css", import.meta.url), "utf8");
const officePartComposer = readFileSync(
  new URL("../workorders/part-requests/OfficePartComposer.jsx", import.meta.url),
  "utf8",
);

test("shared buttons render icons beside text with stable flex geometry", () => {
  assert.match(button, /<Icon aria-hidden="true" focusable="false" \/>/);
  assert.match(button, /<span>\{children\}<\/span>/);
  assert.match(controls, /\.button\s*>\s*svg\s*\{[^}]*align-self:\s*center;[^}]*display:\s*block;[^}]*flex:\s*0 0 auto;/s);
  assert.match(controls, /\.button\s*>\s*span\s*\{[^}]*display:\s*block;[^}]*line-height:/s);
});

test("primary buttons keep visible content during hover and keyboard focus", () => {
  assert.match(controls, /\.button\.primary:hover,\s*\.button\.primary:focus-visible\s*\{[^}]*background:\s*#175cd3;[^}]*border-color:\s*#175cd3;[^}]*color:\s*#fff;/s);
});

test("shared text controls retain standard desktop and touch target floors", () => {
  assert.match(controls, /\.button\s*\{[^}]*min-height:\s*42px;/s);
  assert.match(controls, /\.control-panel input,[\s\S]*?\.control-panel textarea\s*\{[^}]*min-height:\s*40px;/s);
  assert.match(controls, /@media \(max-width: 700px\)[\s\S]*?\.button\.success,[\s\S]*?\.control-panel textarea\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(controls, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\),/);
});

test("native checkbox and radio visuals reset dense control-panel geometry", () => {
  const denseRule = controls.indexOf(".control-panel input,");
  const nativeRule = controls.indexOf('input[type="checkbox"],');
  assert.ok(nativeRule > denseRule, "native control reset must follow the dense control-panel rule");
  assert.match(controls, /input\[type="checkbox"\],[\s\S]*?input\[type="radio"\]\s*\{[^}]*height:\s*18px;[^}]*min-height:\s*0;[^}]*padding:\s*0;[^}]*width:\s*18px;/s);
});

test("shared search controls use the standard desktop and touch target floors", () => {
  assert.match(searchControls, /height:\s*40px;\s*\n\s*min-height:\s*40px;/);
  assert.match(searchControls, /@media \(max-width:\s*760px\)[\s\S]*height:\s*44px;\s*min-height:\s*44px;/);
});

test("all direct button icons receive a low-specificity alignment fallback", () => {
  assert.match(foundation, /:where\(button:has\(> svg\)\)\s*\{[^}]*align-items:\s*center;[^}]*display:\s*inline-flex;/s);
  assert.match(foundation, /:where\(button\s*>\s*svg\)\s*\{[^}]*align-self:\s*center;[^}]*display:\s*block;[^}]*flex:\s*0 0 auto;/s);
});

test("office planning action uses the shared icon slot instead of nesting SVG in text", () => {
  assert.match(officePartComposer, /<Button\s+icon=\{Plus\}[\s\S]*?\{t\("parts\.planSourcePart"\)\}\s*<\/Button>/);
  assert.doesNotMatch(officePartComposer, /<Button[^>]*><Plus \/> \{t\("parts\.planSourcePart"\)\}<\/Button>/);
});
