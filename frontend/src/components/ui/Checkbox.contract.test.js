import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const checkboxComponent = fileURLToPath(new URL("./Checkbox.jsx", import.meta.url));
const checkboxTypeReference = /type\s*=\s*(?:["']checkbox["']|\{\s*(?:["']checkbox["']|`checkbox`|[\w$.]*checkbox[\w$.]*)\s*\})/i;

async function jsxFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) return jsxFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".jsx") ? [entryPath] : [];
  }));
  return nested.flat();
}

test("all checkboxes render through the shared Checkbox component", async () => {
  const directCheckboxOwners = [];
  for (const filePath of await jsxFiles(sourceRoot)) {
    const source = await readFile(filePath, "utf8");
    if (checkboxTypeReference.test(source)) directCheckboxOwners.push(filePath);
  }

  assert.deepEqual(directCheckboxOwners, [checkboxComponent]);
});

test("direct checkbox detection includes JSX expression syntax", () => {
  assert.match('<input type={"checkbox"} />', checkboxTypeReference);
  assert.match("<input type={'checkbox'} />", checkboxTypeReference);
  assert.match("<input type={`checkbox`} />", checkboxTypeReference);
  assert.match("<input type={INPUT_TYPES.CHECKBOX} />", checkboxTypeReference);
});

test("shared checkbox keeps a compact visual size and forwards native props", async () => {
  const component = await readFile(new URL("./Checkbox.jsx", import.meta.url), "utf8");
  const css = await readFile(new URL("./checkbox.css", import.meta.url), "utf8");

  assert.match(component, /forwardRef/);
  assert.match(component, /\.\.\.props/);
  assert.match(component, /type="checkbox"/);
  assert.match(css, /height:\s*16px\s*!important/);
  assert.match(css, /width:\s*16px\s*!important/);
});
