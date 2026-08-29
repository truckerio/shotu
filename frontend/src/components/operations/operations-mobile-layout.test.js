import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL("./OperationsWorkspace.jsx", import.meta.url);
const cssUrl = new URL("./operations.css", import.meta.url);
const sharedCssUrl = new URL("./operational-collection-page.css", import.meta.url);
const adminCssUrl = new URL("../../features/admin/admin.css", import.meta.url);

test("desktop Operations overrides the shared fallback with nine matching column tracks and requests 20 records", async () => {
  const [component, css, sharedCss] = await Promise.all([
    readFile(componentUrl, "utf8"),
    readFile(cssUrl, "utf8"),
    readFile(sharedCssUrl, "utf8"),
  ]);
  const baseTable = css.match(/\.operational-collection-table\.operations-table\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  const desktop = css.slice(0, css.indexOf("@media (max-width: 960px)"));

  assert.equal((baseTable.match(/minmax\(/g) || []).length, 9, "Operations needs one desktop track per visible header");
  assert.match(css, /\.operational-collection-table\.operations-table\s*\{/);
  assert.match(sharedCss, /\.operational-collection-table\s*\{[\s\S]*--operational-collection-columns:/);
  assert.match(component, /buildOperationsQuery\(filters, page, 20\)/);
  assert.doesNotMatch(desktop, /operations-created[\s\S]*?display:\s*none/);
  assert.doesNotMatch(desktop, /operations-odoo[\s\S]*?display:\s*none/);
});

test("Admin workspace uses the available viewport while retaining desktop gutters", async () => {
  const adminCss = await readFile(adminCssUrl, "utf8");

  assert.match(adminCss, /\.admin-workspace-header\s*\{[^}]*max-width:\s*none;[^}]*padding:\s*20px 32px 0;[^}]*width:\s*100%;/s);
  assert.match(adminCss, /\.admin-content\s*\{[^}]*max-width:\s*none;[^}]*padding:\s*32px 32px 60px;[^}]*width:\s*100%;/s);
});

test("Operations cards use the shared tablet breakpoint with scoped compact overrides", async () => {
  const [css, sharedCss] = await Promise.all([readFile(cssUrl, "utf8"), readFile(sharedCssUrl, "utf8")]);
  const tablet = css.slice(css.indexOf("@media (max-width: 960px)"), css.indexOf("@media (max-width: 700px)"));
  const sharedPhone = sharedCss.slice(sharedCss.indexOf("@media (max-width: 700px)"));

  assert.match(css, /\.operations-identity\s*\{\s*align-content:\s*flex-start;\s*flex-wrap:\s*nowrap;\s*\}/);
  assert.match(sharedPhone, /\.operational-collection-table\s*\{[\s\S]*display:\s*grid;[\s\S]*gap:\s*10px;/);
  assert.match(sharedPhone, /\.operational-collection-row\s*\{[\s\S]*border-radius:\s*10px;[\s\S]*padding:\s*14px;/);
  assert.match(tablet, /\.operational-collection-row\.operations-row\s*\{[\s\S]*border-radius:\s*10px;[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;[\s\S]*padding:\s*14px;/);
  assert.match(tablet, /\.operations-row \.operations-identity\s*\{[\s\S]*align-content:\s*flex-start;[\s\S]*display:\s*flex;[\s\S]*flex-wrap:\s*nowrap;[\s\S]*grid-template-columns:\s*none;/);
  assert.match(tablet, /\.operations-row > \.operations-wait,[\s\S]*\.operations-row > \.operations-activity\s*\{[\s\S]*display:\s*none;/);
  assert.doesNotMatch(css, /@media \(max-width:\s*600px\)/);
});

test("desktop lifecycle and attention content share one centered column", async () => {
  const css = await readFile(cssUrl, "utf8");
  const desktop = css.slice(css.indexOf("@media (min-width: 801px)"), css.indexOf("@media (min-width: 1500px)"));

  assert.match(desktop, /\.operations-state\s*\{[\s\S]*align-items:\s*center;[\s\S]*text-align:\s*center;/);
  assert.match(desktop, /\.operations-state \.operations-attention-list\s*\{[\s\S]*justify-content:\s*center;[\s\S]*width:\s*100%;/);
});

test("desktop Operations rows share table separators without state-owned card outlines", async () => {
  const [component, css, sharedCss] = await Promise.all([
    readFile(componentUrl, "utf8"),
    readFile(cssUrl, "utf8"),
    readFile(sharedCssUrl, "utf8"),
  ]);
  const desktop = css.slice(0, css.indexOf("@media (max-width: 800px)"));

  assert.match(sharedCss, /\.operational-collection-table\s*\{[\s\S]*border-bottom:\s*1px solid #d0d5dd;[\s\S]*border-top:\s*1px solid #d0d5dd;/);
  assert.match(sharedCss, /\.operational-collection-row\s*\{[\s\S]*border-top:\s*1px solid #eaecf0;/);
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
  const compact = css.slice(css.indexOf("@media (max-width: 960px)"), css.indexOf("@media (max-width: 700px)"));

  assert.match(compact, /\.operations-row \.operations-concern\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1;[\s\S]*grid-row:\s*2;/);
  assert.match(compact, /\.operations-row \.operations-mechanic\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1;[\s\S]*grid-row:\s*3;/);
  assert.match(compact, /\.operations-row \.operations-state\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1;[\s\S]*grid-row:\s*4;[\s\S]*grid-template-columns:\s*max-content minmax\(0,\s*1fr\);/);
  assert.match(compact, /\.operations-state \.operations-attention-list\s*\{[\s\S]*grid-column:\s*2;[\s\S]*justify-content:\s*flex-end;/);
});

test("phone cards avoid duplicate Overdue while preserving its audit reason in markup", async () => {
  const [component, css] = await Promise.all([
    readFile(componentUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(component, /className=\{`operations-attention-\$\{reason\}`\}/);
  assert.match(css, /@media \(max-width: 960px\)[\s\S]*\.operations-state \.operations-attention-overdue,[\s\S]*\.operations-state \.operations-no-attention\s*\{[\s\S]*display:\s*none;/);
});
