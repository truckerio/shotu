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

test("desktop lifecycle and attention content share one centered column", async () => {
  const css = await readFile(cssUrl, "utf8");
  const desktop = css.slice(css.indexOf("@media (min-width: 801px)"), css.indexOf("@media (min-width: 1500px)"));

  assert.match(desktop, /\.operations-state\s*\{[\s\S]*align-items:\s*center;[\s\S]*text-align:\s*center;/);
  assert.match(desktop, /\.operations-state \.operations-attention-list\s*\{[\s\S]*justify-content:\s*center;[\s\S]*width:\s*100%;/);
});

test("desktop Operations rows share table separators without state-owned card outlines", async () => {
  const [component, css] = await Promise.all([
    readFile(componentUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);
  const desktop = css.slice(0, css.indexOf("@media (max-width: 800px)"));

  assert.match(desktop, /\.operations-table\s*\{[\s\S]*border-bottom:\s*1px solid #d0d5dd;[\s\S]*border-top:\s*1px solid #d0d5dd;/);
  assert.match(desktop, /\.operations-row\s*\{[\s\S]*border-top:\s*1px solid #eaecf0;/);
  assert.doesNotMatch(desktop, /\.operations-row\.is-overdue\s*\{[^}]*box-shadow:/);
  assert.match(component, /\["overdue", "revision_requested", "parts", "office_help", "missing_info"\]/);
  assert.match(component, /operations-row lifecycle-tone-\$\{item\.lifecycle \|\| "unknown"\}/);
  assert.match(component, /has-attention attention-tone-\$\{attentionTone\}/);
  assert.match(desktop, /\.operations-row:not\(\.has-attention\)\s*\{\s*background:\s*var\(--operations-lifecycle-bg, #fff\);/);
  for (const lifecycle of ["open", "accepted", "in_progress", "mechanic_done", "closed", "odoo_entered", "cancelled"]) {
    assert.match(desktop, new RegExp(`\\.operations-row\\.lifecycle-tone-${lifecycle}\\s*\\{[^}]*--operations-lifecycle-bg:`));
  }
  assert.match(desktop, /\.operations-row\.has-attention\s*\{\s*background:\s*var\(--operations-attention-bg\);/);
  assert.match(desktop, /\.operations-row\.has-attention\.is-interactive:hover\s*\{\s*background:\s*var\(--operations-attention-hover\);/);
  for (const tone of ["overdue", "revision_requested", "parts", "office_help", "missing_info"]) {
    assert.match(desktop, new RegExp(`\\.operations-row\\.attention-tone-${tone}\\s*\\{[^}]*--operations-attention-bg:`));
  }
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
