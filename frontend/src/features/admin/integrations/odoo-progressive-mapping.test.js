import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("./OdooProgressiveMapping.jsx", import.meta.url);
const stylesUrl = new URL("./odoo-progressive-mapping.css", import.meta.url);
const integrationStylesUrl = new URL("./integrations.css", import.meta.url);

async function readWorkflow() {
  return readFile(workflowUrl, "utf8");
}

test("progressive Odoo mapping opens on vehicles and keeps warehouses independently available", async () => {
  const source = await readWorkflow();

  assert.match(source, /export function OdooProgressiveMapping/);
  assert.match(source, /useState\("vehicles"\)/);
  assert.match(source, /Truck mappings/);
  assert.match(source, /Location to warehouse mappings/);
  assert.match(source, /setActiveStep\("vehicles"\)/);
  assert.match(source, /setActiveStep\("warehouses"\)/);
  assert.match(source, /const \[warehouseExpanded, setWarehouseExpanded\] = useState\(false\)/);
  assert.match(source, /aria-expanded=\{warehouseExpanded\}/);
  assert.match(source, /setWarehouseExpanded\(\(current\) => !current\)/);
});

test("progressive Odoo mapping exposes review counts and a bounded mapping viewport", async () => {
  const [source, styles] = await Promise.all([readWorkflow(), readFile(stylesUrl, "utf8")]);

  assert.match(source, /Needs review/);
  assert.match(source, /confirmed/);
  assert.match(source, /odoo-progressive-mapping-list/);
  assert.match(styles, /\.odoo-progressive-mapping-list[\s\S]*max-(?:block-)?size:/);
  assert.match(styles, /\.odoo-progressive-mapping-list[\s\S]*overflow-y:\s*auto/);
});

test("collapsing Odoo mapping sections does not unmount drafts or their field content", async () => {
  const source = await readWorkflow();

  assert.match(source, /hidden=\{!warehouseExpanded\}/);
  assert.match(source, /warehouseDrafts\[location\.id\]/);
  assert.match(source, /vehicleDrafts\[asset\.id\]/);
  assert.doesNotMatch(source, /\{warehouseExpanded\s*&&/);
  assert.doesNotMatch(source, /\{activeStep\s*===\s*["']warehouses["']\s*&&/);
  assert.doesNotMatch(source, /\{activeStep\s*===\s*["']vehicles["']\s*&&/);
});

test("outbound trucks lead the page and inbound inventory locations stay progressively collapsed", async () => {
  const [card, styles] = await Promise.all([
    readFile(new URL("./OdooIntegrationCard.jsx", import.meta.url), "utf8"),
    readFile(integrationStylesUrl, "utf8"),
  ]);

  assert.ok(card.indexOf("<OdooProgressiveMapping") < card.indexOf("<details className=\"odoo-location-mappings"));
  assert.match(card, /<details className="odoo-location-mappings odoo-location-mappings--progressive">/);
  assert.doesNotMatch(card, /<details className="odoo-location-mappings odoo-location-mappings--progressive" open/);
  assert.match(card, /inboundMapped.*mapped.*inboundNeedsReview.*need review/);
  assert.match(styles, /\.odoo-location-mappings--progressive \.odoo-location-list[\s\S]*max-block-size:/);
  assert.match(styles, /\.odoo-location-mappings--progressive \.odoo-location-list[\s\S]*overflow-y:\s*auto/);
});
