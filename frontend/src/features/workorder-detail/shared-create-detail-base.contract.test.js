import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Create and Office Detail use the same flat form skeleton", () => {
  for (const path of ["../workorder-modules/WorkorderCreateModuleHost.jsx", "../workorder-modules/WorkorderDetailModuleHost.jsx"]) {
    const host = source(path);
    assert.match(host, /import \{ WorkorderFormLayout \}/);
    assert.match(host, /<WorkorderFormLayout/);
    for (const slot of ["location", "unit", "concern", "schedule", "assignment", "parts"]) {
      assert.ok(host.includes(`${slot}={`), `${path} uses shared ${slot} slot`);
    }
  }
});

test("Office saves stay announced in the header without adding a success paragraph to Concern", () => {
  const sections = source("./WorkorderDetailSections.jsx");
  const page = source("./WorkorderDetailPage.jsx");
  assert.match(sections, /concern: \{[\s\S]*?message: officeDetailState\.error \|\| isOfficeDetail \? "" : officeDetailState\.message/);
  assert.match(page, /<span className="sr-only" role="status">\{officeDetailState\.message\}<\/span>/);
  assert.match(page, /title=\{officeDetailState\.busy \? "Saving workorder" : officeDetailState\.message \|\| "Save workorder"\}/);
});

test("shared one-page phone header gives identity its own track before actions", () => {
  const css = source("./workorder-detail-toolbar.css");
  assert.match(css, /@media screen and \(max-width: 700px\)[\s\S]*data-workorder-presentation="one-page"[^}]*> \.detail-context-bar\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /data-workorder-presentation="one-page"[^}]*\.detail-context-actions\s*\{[^}]*flex-wrap: wrap;[^}]*justify-content: flex-end;/);
  assert.match(css, /data-workorder-presentation="one-page"[^}]*> \.detail-context-bar\s*\{[^}]*height: auto;[^}]*overflow: visible;/);
  assert.match(css, /data-workorder-presentation="one-page"[^}]*> \.detail-context-bar\s*\{[^}]*min-height: max-content;/);
  assert.match(css, /data-workorder-presentation="one-page"[^}]*\.detail-context-actions > \.button\s*\{[^}]*width: auto;/);
});
