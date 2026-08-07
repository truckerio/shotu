import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("./OdooProgressiveMapping.jsx", import.meta.url);
const stylesUrl = new URL("./odoo-progressive-mapping.css", import.meta.url);
const integrationStylesUrl = new URL("./integrations.css", import.meta.url);

async function readWorkflow() {
  return readFile(workflowUrl, "utf8");
}

test("Odoo mappings use independent settings sections instead of a sequential workflow", async () => {
  const source = await readWorkflow();

  assert.match(source, /export function OdooProgressiveMapping/);
  assert.match(source, /<strong>Truck mapping<\/strong>/);
  assert.match(source, /<strong>Location mapping<\/strong>/);
  assert.equal((source.match(/<details className="odoo-settings-section">/g) || []).length, 2);
  assert.doesNotMatch(source, /Step 1|Step 2|Continue to location mapping/);
  assert.doesNotMatch(source, /<details className="odoo-settings-section" open/);
});

test("progressive Odoo mapping exposes review counts and a bounded mapping viewport", async () => {
  const [source, styles] = await Promise.all([readWorkflow(), readFile(stylesUrl, "utf8")]);

  assert.match(source, /to review/);
  assert.match(source, /mapped/);
  assert.match(source, /odoo-progressive-mapping-list/);
  assert.match(styles, /\.odoo-progressive-mapping-list[\s\S]*max-(?:block-)?size:/);
  assert.match(styles, /\.odoo-progressive-mapping-list[\s\S]*overflow-y:\s*auto/);
});

test("settings sections keep draft controls mounted inside native disclosure content", async () => {
  const source = await readWorkflow();

  assert.match(source, /warehouseDrafts\[location\.id\]/);
  assert.match(source, /vehicleDrafts\[asset\.id\]/);
  assert.match(source, /<details className="odoo-settings-section">[\s\S]*vehicleDrafts/);
  assert.match(source, /<details className="odoo-settings-section">[\s\S]*warehouseDrafts/);
});

test("outbound trucks lead the page and inbound inventory locations stay progressively collapsed", async () => {
  const [card, styles] = await Promise.all([
    readFile(new URL("./OdooIntegrationCard.jsx", import.meta.url), "utf8"),
    readFile(integrationStylesUrl, "utf8"),
  ]);

  assert.ok(card.indexOf("<OdooProgressiveMapping") < card.indexOf("<details className=\"odoo-settings-section odoo-settings-section--inventory"));
  assert.match(card, /<details className="odoo-settings-section odoo-settings-section--inventory">/);
  assert.doesNotMatch(card, /<details className="odoo-settings-section odoo-settings-section--inventory" open/);
  assert.match(card, /\{inboundMapped\} mapped/);
  assert.match(card, /inboundNeedsReview.*to review/);
  assert.match(styles, /\.odoo-settings-section--inventory \.odoo-location-list[\s\S]*max-block-size:/);
  assert.match(styles, /\.odoo-settings-section--inventory \.odoo-location-list[\s\S]*overflow-y:\s*auto/);
});

test("mapping settings use the product's compact flat section treatment", async () => {
  const styles = await readFile(stylesUrl, "utf8");

  assert.match(styles, /\.odoo-settings-section > summary[\s\S]*min-height:\s*56px/);
  assert.match(styles, /\.odoo-settings-section__status > span[\s\S]*color:\s*#667085/);
  assert.match(styles, /\.odoo-progressive-mapping__row[\s\S]*border-bottom:\s*1px solid #eaecf0/);
  assert.doesNotMatch(styles, /box-shadow/);
});
