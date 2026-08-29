import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("inventory scanner uses shared buttons and keeps camera failure on a manual path", async () => {
  const source = await readFile(new URL("./InventoryScanWorkspace.jsx", import.meta.url), "utf8");
  assert.match(source, /import \{ Button \} from "\.\.\/\.\.\/components\/ui\/Button\.jsx"/);
  assert.match(source, /inventoryCameraAvailable\(window\)/);
  assert.match(source, /createInventoryFrameDetector\(window\)/);
  assert.match(source, /Camera access was unavailable/);
  assert.match(source, /Label link or code/);
  assert.match(source, /\/api\/inventory\/resolve/);
});

test("admin opens invoice intake through Inventory while scan links preempt role workspaces", async () => {
  const shell = await readFile(new URL("../admin/workspace/AdminWorkspaceShell.jsx", import.meta.url), "utf8");
  const inventory = await readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8");
  const outlet = await readFile(new URL("../../app/routes/RoleWorkspaceOutlet.jsx", import.meta.url), "utf8");
  assert.match(shell, /<InventoryWorkspace canApplyInventoryCount=\{actor\?\.role === "admin"\} presentation="page" \/>/);
  assert.match(inventory, /<InvoiceExtractionWorkspace embedded availableLocations=\{locations\}/);
  assert.match(outlet, /searchParams\(window\.location\.search\)\.has\("inventoryScan"\)/i);
  assert.match(outlet, /<InventoryScanWorkspace actor=\{actor\} \/>/);
});

test("login preserves only a bounded inventory scan return target", async () => {
  const source = await readFile(new URL("../auth/LoginPage.jsx", import.meta.url), "utf8");
  assert.match(source, /function loginReturnTarget/);
  assert.match(source, /token\.length < 8 \|\| token\.length > 2000/);
  assert.match(source, /window\.location\.replace\(loginReturnTarget\(\)\)/);
  assert.doesNotMatch(source, /window\.location\.replace\("\/"\)/);
});
