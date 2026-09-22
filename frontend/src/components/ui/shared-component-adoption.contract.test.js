import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function jsxFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return jsxFiles(url);
    return entry.name.endsWith(".jsx") ? [url] : [];
  }));
  return nested.flat();
}

test("Inventory and Create Parts route modal and icon actions through shared owners", async () => {
  const inventoryRoot = new URL("../../features/inventory/", import.meta.url);
  const roots = [
    inventoryRoot,
    new URL("../../features/workorder-modules/parts/", import.meta.url),
    new URL("../inventory/", import.meta.url),
  ];
  const files = (await Promise.all(roots.map(jsxFiles))).flat();
  const sources = await Promise.all(files.map(async (url) => ({ url, source: await readFile(url, "utf8") })));

  for (const { url, source } of sources) {
    assert.doesNotMatch(source, /\bModalOverlay\b|<Modal\b|<Dialog\b/, `${url.pathname} bypasses ModalFrame`);
    assert.doesNotMatch(source, /<button[^>]+aria-label=[^>]+(?:Close|Remove)/i, `${url.pathname} bypasses IconButton`);
  }

  const inventoryFiles = await jsxFiles(inventoryRoot);
  const inventorySources = await Promise.all(inventoryFiles.map((url) => readFile(url, "utf8")));
  for (const source of inventorySources) assert.doesNotMatch(source, /<table\b/);

  const reports = await readFile(new URL("../../features/inventory/InventoryReports.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(reports, /<table\b/);
  assert.ok((reports.match(/<OperationalDataTable/g) || []).length >= 4);
});

test("shared dialog surfaces compose the canonical ModalFrame", async () => {
  const [detail, upload] = await Promise.all([
    readFile(new URL("./SecondaryDetailPanel.jsx", import.meta.url), "utf8"),
    readFile(new URL("./UploadDialog.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(detail, /<ModalFrame/);
  assert.match(upload, /<ModalFrame/);
});
