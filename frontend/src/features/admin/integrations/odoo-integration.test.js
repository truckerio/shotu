import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Odoo settings separates inbound stock locations from explicit outbound setup", async () => {
  const [source, workflow] = await Promise.all([
    readFile(new URL("./OdooIntegrationCard.jsx", import.meta.url), "utf8"),
    readFile(new URL("./OdooProgressiveMapping.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(source, /Inventory location mapping/);
  assert.match(source, /Unmatched/);
  assert.match(source, /Ignore this location/);
  assert.match(source, /<option value="">Unmatched<\/option>/);
  assert.match(source, /encodeURIComponent\(item\.externalId\)/);
  assert.match(source, /Sync catalog & history/);
  assert.doesNotMatch(source, /Sync parts, inventory & history/);
  assert.match(source, /Imported \$\{result\.changedCount\} catalog records/);
  assert.doesNotMatch(source, /catalog and inventory records/);
  assert.match(source, /historyOrderCount/);
  assert.match(source, /historyWarning/);
  assert.match(source, /least-privilege Odoo user/);
  assert.match(source, /create\/write access to draft Sales service orders/);
  assert.match(source, /Odoo outbound setup/);
  assert.match(source, /OdooProgressiveMapping/);
  assert.match(workflow, /Location mapping/);
  assert.match(workflow, /Truck mapping/);
  assert.match(source, /Labor product/);
  assert.match(source, /outbound\/readiness/);
  assert.match(source, /outbound\/discover/);
});

test("outbound mappings require explicit confirmation and use bounded vehicle reads", async () => {
  const [source, workflow] = await Promise.all([
    readFile(new URL("./OdooIntegrationCard.jsx", import.meta.url), "utf8"),
    readFile(new URL("./OdooProgressiveMapping.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(source, /limit: "25"/);
  assert.match(source, /confirmVehicleMapping/);
  assert.match(source, /confirmWarehouseMapping/);
  assert.match(source, /confirmLaborProduct/);
  assert.match(source, /status: "mapped", externalId/);
  assert.match(source, /status: "unmatched"/);
  assert.match(source, /status: "ignored"/);
  assert.match(workflow, /Ignore this unit for Odoo outbound/);
  assert.doesNotMatch(source, /onChange=\{\(event\) => confirmVehicleMapping/);
  assert.doesNotMatch(source, /onChange=\{\(event\) => confirmWarehouseMapping/);
  assert.match(workflow, /item\.suggestion\?\.externalId/);
  assert.match(workflow, /Suggested by/);
  assert.match(source, /license plate, but VIN differs/);
});

test("outbound discovery communicates automatic vehicle matching results", async () => {
  const source = await readFile(new URL("./OdooIntegrationCard.jsx", import.meta.url), "utf8");
  assert.match(source, /Sync and auto-match Odoo choices/);
  assert.match(source, /auto-confirmed/);
  assert.match(source, /suggested for review/);
  assert.match(source, /autoMatchedCount/);
  assert.match(source, /vehicleSuggestedCount/);
  assert.match(source, /const result = await api\("\/api\/integrations\/odoo\/outbound\/discover"/);
});

test("outbound setup keeps mobile controls at least 44px and reports unsafe labor units", async () => {
  const source = await readFile(new URL("./OdooIntegrationCard.jsx", import.meta.url), "utf8");
  const css = await readFile(new URL("./integrations.css", import.meta.url), "utf8");
  assert.match(source, /uom_warning/);
  assert.match(source, /Outbound entry remains disabled/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.odoo-outbound-setup input,[\s\S]*min-height: 44px/);
  assert.match(css, /\.odoo-outbound-row,[\s\S]*grid-template-columns: 1fr/);
});

test("Odoo provider is shared through the integration settings registry", async () => {
  const registry = await readFile(new URL("./provider-registry.js", import.meta.url), "utf8");
  const settings = await readFile(new URL("./IntegrationsSettings.jsx", import.meta.url), "utf8");
  assert.match(registry, /id: "odoo"/);
  assert.match(settings, /integrationProvider\("odoo"\)/);
  assert.match(settings, /<OdooIntegrationCard/);
});
