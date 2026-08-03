import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Odoo settings exposes explicit admin location matching without name-based defaults", async () => {
  const source = await readFile(new URL("./OdooIntegrationCard.jsx", import.meta.url), "utf8");
  assert.match(source, /Location matching/);
  assert.match(source, /Unmatched/);
  assert.match(source, /Ignore this location/);
  assert.match(source, /<option value="">Unmatched<\/option>/);
  assert.match(source, /encodeURIComponent\(item\.externalId\)/);
  assert.match(source, /Sync parts, inventory & history/);
  assert.match(source, /historyOrderCount/);
  assert.match(source, /historyWarning/);
  assert.match(source, /Products, Inventory, and Sales service orders/);
});

test("Odoo provider is shared through the integration settings registry", async () => {
  const registry = await readFile(new URL("./provider-registry.js", import.meta.url), "utf8");
  const settings = await readFile(new URL("./IntegrationsSettings.jsx", import.meta.url), "utf8");
  assert.match(registry, /id: "odoo"/);
  assert.match(settings, /integrationProvider\("odoo"\)/);
  assert.match(settings, /<OdooIntegrationCard/);
});
