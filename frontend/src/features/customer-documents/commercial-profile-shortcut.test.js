import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildSync } from "esbuild";

const { outputFiles } = buildSync({
  stdin: {
    contents: `
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { WorkorderCustomerDocumentsPanel } from "./WorkorderCustomerDocumentsPanel.jsx";
      export function render(props) {
        return renderToStaticMarkup(createElement(WorkorderCustomerDocumentsPanel, props));
      }
    `,
    resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "jsx",
  },
  bundle: true, write: false, platform: "node", format: "cjs",
  packages: "external", jsx: "automatic", loader: { ".css": "empty" }, logLevel: "silent",
});
const compiled = { exports: {} };
new Function("require", "module", "exports", outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);

function render({ actorRole = "admin", errorCode = "CUSTOMER_DOCUMENT_PROFILE_UNAVAILABLE", error = "Publish a commercial profile before issuing a priced Estimate.", busy = false } = {}) {
  return compiled.exports.render({ actorRole, companyId: "company-b", locationId: "chino",
    workorderId: "g2026", controller: { error, errorCode, busy, effectiveStatus: "active" } });
}

test("missing commercial profile offers Admin a scoped Create profile link beside the error", () => {
  const html = render();
  assert.match(html, /role="alert"[^>]*>Publish a commercial profile/);
  assert.match(html, />Create profile<\/a>/);
  const anchor = html.match(/<a [^>]*>Create profile<\/a>/)?.[0] || "";
  const href = anchor.match(/href="([^"]+)"/)?.[1].replaceAll("&amp;", "&");
  assert.ok(href);
  const url = new URL(href, "https://workorders.example");
  assert.equal(url.pathname, "/");
  assert.equal(url.searchParams.get("adminView"), "settings");
  assert.equal(url.searchParams.get("settingsTab"), "commercial");
  assert.equal(url.searchParams.get("commercialCompany"), "company-b");
  assert.equal(url.searchParams.get("commercialLocation"), "chino");
  assert.match(anchor, /target="_blank"/);
  assert.match(anchor, /rel="[^"]*noopener/);
});

test("Office gets an Admin instruction instead of an unavailable admin navigation link", () => {
  const html = render({ actorRole: "office" });
  assert.match(html, /Ask an Admin to create the commercial profile/);
  assert.doesNotMatch(html, />Create profile<\/a>/);
});

test("unrelated errors and cleared errors do not offer profile creation", () => {
  for (const values of [
    { errorCode: "FORBIDDEN", error: "Access denied" },
    { errorCode: "", error: "Publish a commercial profile before issuing a priced Estimate." },
    { errorCode: "CUSTOMER_DOCUMENT_PROFILE_UNAVAILABLE", error: "" },
  ]) assert.doesNotMatch(render(values), />Create profile<\/a>|Ask an Admin/);
});
