import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL("./OperationsWorkspace.jsx", import.meta.url);
const cssUrl = new URL("./operations.css", import.meta.url);

test("phone Operations cards use the shared 700px breakpoint and reset tablet label grids", async () => {
  const css = await readFile(cssUrl, "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 700px)"));

  assert.match(css, /\.operations-identity\s*\{\s*align-content:\s*flex-start;\s*flex-wrap:\s*nowrap;\s*\}/);
  assert.match(phone, /\.operations-table\s*\{[\s\S]*display:\s*grid;[\s\S]*gap:\s*10px;/);
  assert.match(phone, /\.operations-row\s*\{[\s\S]*border-radius:\s*10px;[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;[\s\S]*padding:\s*14px;/);
  assert.match(phone, /\.operations-row \.operations-identity\s*\{[\s\S]*align-content:\s*flex-start;[\s\S]*display:\s*flex;[\s\S]*flex-wrap:\s*nowrap;[\s\S]*grid-template-columns:\s*none;/);
  assert.doesNotMatch(css, /@media \(max-width:\s*600px\)/);
});

test("phone Operations cards keep concern, mechanic, lifecycle, and attention in stable rows", async () => {
  const css = await readFile(cssUrl, "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 700px)"));

  assert.match(phone, /\.operations-concern\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1;[\s\S]*grid-row:\s*2;/);
  assert.match(phone, /\.operations-mechanic\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1;[\s\S]*grid-row:\s*3;/);
  assert.match(phone, /\.operations-row \.operations-state\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1;[\s\S]*grid-row:\s*4;[\s\S]*grid-template-columns:\s*max-content minmax\(0,\s*1fr\);/);
  assert.match(phone, /\.operations-state \.operations-attention-list\s*\{[\s\S]*grid-column:\s*2;[\s\S]*justify-content:\s*flex-end;/);
});

test("phone cards avoid duplicate Overdue while preserving its audit reason in markup", async () => {
  const [component, css] = await Promise.all([
    readFile(componentUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(component, /className=\{`operations-attention-\$\{reason\}`\}/);
  assert.match(css, /\.operations-state \.operations-attention-overdue,[\s\S]*\.operations-state \.operations-no-attention\s*\{[\s\S]*display:\s*none;/);
});
