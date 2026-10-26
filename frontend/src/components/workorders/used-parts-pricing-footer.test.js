import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildSync } from "esbuild";

// Render the real editor and footer together: a model-only test cannot catch
// the editor dropping its server summary when the financial footer is present.
const { outputFiles } = buildSync({
  stdin: {
    contents: `
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { UsedPartsEditor } from "./UsedPartsEditor.jsx";
      export function render(props) {
        return renderToStaticMarkup(createElement(UsedPartsEditor, props));
      }
    `,
    resolveDir: fileURLToPath(new URL(".", import.meta.url)),
    loader: "jsx",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  packages: "external",
  jsx: "automatic",
  loader: { ".css": "empty" },
  logLevel: "silent",
});
const compiled = { exports: {} };
new Function("require", "module", "exports", outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { render } = compiled.exports;

const completePricing = { status: "complete", currency: "USD", partsTotal: "122.50", laborTotal: "100", grandTotal: "222.50" };
const mixedPricing = { status: "complete", currency: "USD", partsTotal: "98.0000", laborTotal: "100.0000", grandTotal: "198.0000", missingCount: 0, rowCount: 2 };

function footer(pricing, overrides = {}) {
  const html = render({
    role: "office", parts: [], disabled: true, presentation: "one-page",
    detail: { workorder: { id: "g2026", formData: {} }, workorderPricing: pricing },
    financialFooter: { projection: null, message: "" },
    ...overrides,
  });
  return html.match(/<section[^>]*aria-label="Workorder pricing"[^>]*>[\s\S]*?<\/section>/)?.[0] || "";
}

test("G2026 batch cost part and selling labor display $198 in every editor layout", () => {
  for (const layout of [{ presentation: "one-page" }, { presentation: "panel" }, { presentation: "panel", disabled: false }]) {
    const html = footer(mixedPricing, layout);
    assert.match(html, /Parts &amp; labor<\/span><strong[^>]*>\$198\.00/);
    assert.doesNotMatch(html, /Internal cost and selling prices are mixed/);
  }
});

test("complete saved pricing keeps Parts & labor visible while customer totals require a projection", () => {
  const html = footer(completePricing);
  assert.match(html, /Parts &amp; labor<\/span><strong[^>]*>\$222\.50/);
  assert.match(html, />Total<\/span><strong class="is-placeholder">—/);
  assert.doesNotMatch(html, /Incomplete pricing/);
});

test("current server projection owns totals for mixed-source pricing", () => {
  const html = footer(mixedPricing, { financialFooter: {
    projection: { financialFingerprint: "current", currency: "USD", subtotal: "198", discount: "0", tax: "0", total: "198" },
  } });
  assert.match(html, />Total<\/span><strong>\$198\.00/);
  assert.doesNotMatch(html, /Incomplete pricing|Internal cost/);
});

test("dirty financial sources hide saved subtotal and retain the save instruction", () => {
  const html = footer(completePricing, { financialFooter: { projection: null, message: "Save changes to update totals." } });
  assert.match(html, /Save changes to update totals/);
  assert.doesNotMatch(html, /\$222\.50/);
});

test("pending and failed financial previews hide saved subtotal and retain their messages", () => {
  for (const message of ["Updating totals…", "Current charges could not be calculated."]) {
    const html = footer(completePricing, { financialFooter: { projection: null, message } });
    assert.ok(html.includes(message));
    assert.doesNotMatch(html, /\$222\.50/);
  }
});

test("unfingerprinted previews cannot supply customer totals", () => {
  const html = footer(completePricing, { financialFooter: {
    projection: { currency: "USD", subtotal: "999", total: "999" },
  } });
  assert.match(html, /\$222\.50/);
  assert.doesNotMatch(html, /\$999/);
  assert.match(html, />Total<\/span><strong class="is-placeholder">—/);
});

test("mechanics and hidden financial footers expose no pricing summary", () => {
  assert.equal(footer(mixedPricing, { role: "mechanic" }), "");
  assert.equal(footer(mixedPricing, { financialFooter: { hidden: true } }), "");
});
