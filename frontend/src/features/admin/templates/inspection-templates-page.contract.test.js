import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function source() { return readFile(new URL("./InspectionTemplatesPage.jsx", import.meta.url), "utf8"); }

test("published templates create a revision instead of mutating the immutable version", async () => {
  const page = await source();
  assert.match(page, /POST \/api\/admin\/inspection-templates\/:versionId\/revisions/);
  assert.match(page, /\/revisions`, \{ method: "POST"/);
  assert.match(page, /onCreateRevision=\{createRevision\}/);
});

test("publish has one atomic request contract and never saves through PATCH first", async () => {
  const page = await source();
  assert.match(page, /publishAtomically/);
  const publish = page.slice(page.indexOf("async function publish"), page.indexOf("return <section"));
  assert.match(publish, /definition: definition\(template\)/);
  assert.equal((publish.match(/method: "PATCH"/g) || []).length, 0);
  assert.equal((publish.match(/\/publish/g) || []).length, 1);
});

test("draft autosave is single-flight, version-aware, and exposes conflict recovery", async () => {
  const page = await source();
  assert.match(page, /inFlight: false/);
  assert.match(page, /versions: new Map\(\)/);
  assert.match(page, /if \(saveRef\.current\.inFlight/);
  assert.match(page, /preserveDraft: true/);
  assert.match(page, /onRetrySave=\{retryLatestSave\}/);
  assert.match(page, /onReloadServer=\{reloadServerVersion\}/);
});
