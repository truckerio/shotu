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

test("published template archive requires complete replacement choices and preserves recoverable errors", async () => {
  const ui = await source();
  assert.match(ui, /template\.status === "published"/);
  assert.match(ui, /active\.some\(\(assignment\) => !replacement\[assignment\.id\]\)/);
  assert.match(ui, /active\.map\(\(assignment\) => \(\{ assignmentId: assignment\.id, expectedVersion: assignment\.version, replacementVersionId:/);
  assert.match(ui, /await onArchive\?\./);
  assert.match(ui, /setArchiveError\(error\.message\)/);
  assert.match(ui, /role="alert"/);
  assert.match(ui, /Confirm archive/);
  assert.match(ui, /Cancel/);
  assert.doesNotMatch(ui, /Delete template/);
});
