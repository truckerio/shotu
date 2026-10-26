import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildSync } from "esbuild";

const { outputFiles } = buildSync({
  stdin: { contents: `import { createElement } from 'react'; import { renderToStaticMarkup } from 'react-dom/server';
    import { CustomerDocumentRenderer } from './CustomerDocumentRenderer.jsx';
    export const render = (projection) => renderToStaticMarkup(createElement(CustomerDocumentRenderer, {projection}));`,
  resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "jsx" },
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
  loader: { ".css": "empty" }, logLevel: "silent",
});
const compiled = { exports: {} };
new Function("require", "module", "exports", outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);

function renderLine(line) {
  return compiled.exports.render({ currency: "USD", lines: [{ id: "part", description: "Batch part", unit: "ea", ...line }] });
}

test("weighted batch customer line labels the rounded average and retains its exact amount", () => {
  const html = renderLine({ quantity: "1000", unitPrice: "0.0101", sourceTotal: "10.0500", total: "10.05" });
  assert.match(html, /Avg\. \$0\.0101/);
  assert.match(html, /\$10\.05/);
});

test("ordinary unit prices retain cents without an average label", () => {
  const html = renderLine({ quantity: "1", unitPrice: "98", sourceTotal: "98", total: "98" });
  assert.match(html, /\$98\.00/);
  assert.doesNotMatch(html, /Avg\./);
});

test("sub-cent unit prices keep precision when their multiplication already matches the total", () => {
  const html = renderLine({ quantity: "1000", unitPrice: "0.0101", sourceTotal: "10.1000", total: "10.10" });
  assert.match(html, /\$0\.0101/);
  assert.doesNotMatch(html, /Avg\./);
});
