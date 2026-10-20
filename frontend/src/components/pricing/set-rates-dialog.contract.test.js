import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const shared = new URL("./SetRatesDialog.jsx", import.meta.url);
const wrapper = new URL("./PartRatesDialog.jsx", import.meta.url);

test("shared rates dialog exposes both rate types and stays open after save failure", async () => {
  const source = await readFile(shared, "utf8");
  assert.match(source, /Internal price/);
  assert.match(source, /Selling price/);
  assert.match(source, /Same price for every batch/);
  assert.match(source, /Markup % on batch cost/);
  assert.match(source, /aria-label="Rate type"/);
  assert.match(source, /aria-label="Method"/);
  assert.match(source, /await onSave/);
  assert.ok(source.indexOf("await onSave") < source.indexOf("onClose?.();", source.indexOf("await onSave")));
  assert.match(source, /catch \(failure\)/);
});

test("part wrapper keeps scoped API authorities, capabilities, versions, and retry keys", async () => {
  const source = await readFile(wrapper, "utf8");
  assert.match(source, /partRatePaths\(catalogPartId, locationId\)/);
  assert.match(source, /editablePartRateKinds/);
  assert.match(source, /expectedVersion: internalState\.expectedVersion/);
  assert.match(source, /expectedVersion: Number\(state\.selling\?\.writeVersion \|\| 0\)/);
  assert.match(source, /retryCommand/);
  assert.match(source, /notifyRateSaved/);
  assert.match(source, /useMemo/);
  assert.match(source, /Company default rates/);
});
