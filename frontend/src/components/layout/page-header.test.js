import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./PageHeader.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./page-header.css", import.meta.url), "utf8");

test("shared page header places navigation above title and actions", () => {
  const leading = component.indexOf('className="page-header-leading"');
  const heading = component.indexOf('className="page-header-heading"');

  assert.ok(leading > 0 && leading < heading, "leading navigation must precede the heading row");
  assert.match(styles, /\.page-header-leading\s*\{[^}]*grid-column:\s*1 \/ -1;/s);
  assert.doesNotMatch(component, /<div className="page-header-heading">\s*\{leading\}/s);
});

test("shared page header owns balanced responsive proportions", () => {
  assert.match(styles, /\.page-header-copy\s*\{[^}]*max-width:\s*720px;/s);
  assert.match(styles, /\.page-header-actions\s*\{[^}]*flex-wrap:\s*wrap;/s);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.page-header\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  assert.match(styles, /\.page-header-actions \.button\.primary,[\s\S]*?\.page-header-actions \[role="combobox"\]\s*\{[^}]*min-height:\s*44px;/s);
});

test("shared page header supports embedded heading semantics", () => {
  assert.match(component, /headingLevel = 1/);
  assert.match(component, /headingLevel === 2 \? "h2" : "h1"/);
  assert.match(component, /<Heading>\{title\}<\/Heading>/);
  assert.match(styles, /\.page-header-copy :is\(h1, h2\)/);
});
