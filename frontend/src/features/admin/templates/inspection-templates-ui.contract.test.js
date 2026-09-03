import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = () => readFile(new URL("./InspectionTemplatesWorkspace.jsx", import.meta.url), "utf8");

test("templates UI has a compact preset menu, assignment peer view, revision action, and publish", async () => {
  const ui = await source();
  for (const required of ["Templates", "Assignments", "Create template", "Weekly Truck", "Weekly Trailer", "Publish", "Create revision", "Retry", "Reload", "onChange?.", "onPublish?.", "onCreate?.", "onCreateRevision?.", "onSelect?."]) assert.match(ui, new RegExp(required.replace(/[?.&]/g, "\\$&")));
  assert.doesNotMatch(ui, /Blank custom|Use Weekly/);
});

test("templates UI uses accessible controls and compact Edit Preview modes", async () => {
  const ui = await source();
  assert.match(ui, /role="tablist"/);
  assert.match(ui, /aria-live="polite"/);
  assert.match(ui, /aria-label={`Move \$\{section.title\} up`}/);
  assert.match(ui, /aria-label={`Remove \$\{check.label\}`}/);
  assert.match(ui, /Pass · Issue · N\/A/);
  assert.doesNotMatch(ui, /FMCSA|Annual/);
  const css = await readFile(new URL("./inspection-templates.css", import.meta.url), "utf8");
  assert.match(css, /min-height: 44px/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
