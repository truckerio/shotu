import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const button = readFileSync(new URL("../ui/Button.jsx", import.meta.url), "utf8");
const controls = readFileSync(new URL("./legacy-form-controls.css", import.meta.url), "utf8");
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

test("all direct button icons receive a low-specificity alignment fallback", () => {
  assert.match(foundation, /:where\(button:has\(> svg\)\)\s*\{[^}]*align-items:\s*center;[^}]*display:\s*inline-flex;/s);
  assert.match(foundation, /:where\(button\s*>\s*svg\)\s*\{[^}]*align-self:\s*center;[^}]*display:\s*block;[^}]*flex:\s*0 0 auto;/s);
});

test("office part action uses the shared icon slot instead of nesting SVG in text", () => {
  assert.match(officePartComposer, /<Button\s+icon=\{Plus\}[\s\S]*?Add approved part\s*<\/Button>/);
  assert.doesNotMatch(officePartComposer, /<Button[^>]*><Plus \/> Add approved part<\/Button>/);
});
