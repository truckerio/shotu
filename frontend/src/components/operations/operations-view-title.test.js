import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./OperationsViewTitle.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./operations-view-title.css", import.meta.url), "utf8");

test("Operations title switcher exposes the two peer views from the page heading", () => {
  assert.match(component, /id: "workorders", label: "Workorders"/);
  assert.match(component, /id: "inspections", label: "Inspections"/);
  assert.match(component, /if \(!canSwitch\) return selected\.label;/);
  assert.match(component, /<MenuTrigger>/);
  assert.match(component, /aria-label=\{`Current view: \$\{selected\.label\}`\}/);
  assert.match(component, /aria-label="Choose Operations view"/);
  assert.match(component, /aria-current=\{product === view\.id \? "page" : undefined\}/);
});

test("Operations title switcher keeps menu choices and phone target sizes accessible", () => {
  assert.match(styles, /\.operations-page-title-menu-item\s*\{[\s\S]*?min-height:\s*52px;/);
  assert.match(styles, /\.operations-page-title-trigger:focus-visible\s*\{[\s\S]*?outline:\s*2px solid/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.operations-page-title-trigger\s*\{[\s\S]*?min-height:\s*44px;/);
  assert.match(styles, /\.operations-page-title-menu-item strong\s*\{[\s\S]*?font-size:\s*14px;[\s\S]*?font-weight:\s*var\(--weight-semibold\);/);
});
