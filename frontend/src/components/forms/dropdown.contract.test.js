import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL("./Dropdown.jsx", import.meta.url);
const cssUrl = new URL("./dropdown.css", import.meta.url);
const frontendUrl = new URL("../../", import.meta.url);

test("shared dropdown supplies accessible selection, chevron, and motion", async () => {
  const [component, css] = await Promise.all([
    readFile(componentUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(component, /SelectValue/);
  assert.match(component, /\{\(\{ selectedText \}\) => selectedText\}/);
  assert.match(component, /ListBoxItem/);
  assert.match(component, /isRequired=\{required \|\| Boolean\(ariaRequired\)\}/);
  assert.match(component, /isDisabled=\{disabled\}/);
  assert.match(component, /textValue=\{option\.textValue\}/);
  assert.match(component, /ChevronDown className="dropdown-select-chevron"/);
  assert.match(component, /Check className="dropdown-select-check"/);
  assert.match(component, /className=\{joinClassNames\("dropdown-select", className\)\}/);
  assert.match(css, /\.dropdown-select\[data-open\] \.dropdown-select-chevron/);
  assert.match(css, /\.dropdown-select-popover\[data-entering\]/);
  assert.match(css, /\.dropdown-select-popover\[data-exiting\]/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("runtime JSX no longer renders native select fields", async () => {
  const entries = await readdir(frontendUrl, { recursive: true, withFileTypes: true });
  const jsxFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsx"));
  const offenders = [];

  for (const entry of jsxFiles) {
    const filePath = `${entry.parentPath}/${entry.name}`;
    const source = await readFile(filePath, "utf8");
    if (/<select\b/.test(source)) offenders.push(`${entry.parentPath}/${entry.name}`);
  }

  assert.deepEqual(offenders, []);
});
