import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsUrl = new URL("./IntegrationsSettings.jsx", import.meta.url);
const clientCardUrl = new URL("./IntegrationClientsCard.jsx", import.meta.url);
const stylesUrl = new URL("./integrations.css", import.meta.url);

test("admin integration access shows the raw client token once and supports revocation", async () => {
  const [settings, clientCard] = await Promise.all([
    readFile(settingsUrl, "utf8"),
    readFile(clientCardUrl, "utf8"),
  ]);

  assert.match(settings, /setCreatedToken\(result\.token \|\| ""\)/);
  assert.match(settings, /onDismissToken=\{\(\) => setCreatedToken\(""\)\}/);
  assert.match(settings, /\/api\/integrations\/clients\/\$\{encodeURIComponent\(clientId\)\}\/revoke/);
  assert.match(clientCard, /The raw token is shown once/);
  assert.match(clientCard, /It cannot be shown again/);
  assert.match(clientCard, />\s*Revoke\s*</);
});

test("integration settings cards remain contained and actionable on phone widths", async () => {
  const styles = await readFile(stylesUrl, "utf8");

  assert.match(styles, /\.integration-provider-grid[\s\S]*min-width:\s*0/);
  assert.match(styles, /\.integration-card[\s\S]*box-sizing:\s*border-box[\s\S]*width:\s*100%/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.integration-client-form > div[\s\S]*flex-direction:\s*column/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.integration-client-form \.button[\s\S]*min-height:\s*44px/);
});

test("Odoo uses the same provider-card width and adapts its setup inside that card", async () => {
  const styles = await readFile(stylesUrl, "utf8");

  assert.match(styles, /\.odoo-integration-card\s*\{\s*container-type:\s*inline-size/);
  assert.doesNotMatch(styles, /\.odoo-integration-card\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
  assert.doesNotMatch(styles, /\.odoo-integration-card\s*\{[^}]*max-width:\s*none/);
  assert.match(styles, /@container \(max-width: 680px\)[\s\S]*\.odoo-outbound-summary[\s\S]*grid-template-columns:\s*repeat\(2/);
});

test("Samsara action errors render once inside the provider card", async () => {
  const [settings, card] = await Promise.all([
    readFile(settingsUrl, "utf8"),
    readFile(new URL("./SamsaraIntegrationCard.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(settings, /actionError=\{notice\.target === "samsara" \? notice\.error : ""\}/);
  assert.match(settings, /notice\.error && notice\.target !== "samsara"/);
  assert.doesNotMatch(settings, /setStatus\(\(current\) => \(\{[\s\S]*status: "error"/);
  assert.match(card, /const error = actionError \|\| status\?\.error/);
});
