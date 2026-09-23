// Authenticated local-only proof for Odoo catalog pricing fallback and local precedence.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { closePool, getPool } from "../../src/server/db/pool.js";
import { buildQaAccountManifest } from "./account-manifest.js";
import { RoleApiClient } from "./e2e/api-client.js";
import { runQaAccountCommand } from "./manage-qa-accounts.js";

const baseUrl = new URL(process.env.QA_ODOO_PRICING_URL || "http://localhost:4173");
const database = new URL(process.env.DATABASE_URL || "http://invalid");
assert.ok(["localhost", "127.0.0.1"].includes(baseUrl.hostname), "Browser proof is local-only.");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname), "Database proof is local-only.");

const output = process.env.QA_ODOO_PRICING_OUTPUT || `/tmp/odoo-commercial-pricing-${Date.now()}`;
const qaPassword = String(process.env.QA_ACCOUNT_PASSWORD || "").trim();
const qaNamespace = process.env.QA_ACCOUNT_NAMESPACE || "odoo-commercial-pricing";
assert.ok(qaPassword, "QA_ACCOUNT_PASSWORD is required.");
await mkdir(output, { recursive: true });
const pool = getPool();
const client = await RoleApiClient.create({ role: "admin", baseUrl, timeoutMs: 20_000 });
let browser;
let fixture;
let qaPrepared = false;
try {
  await runQaAccountCommand({ argv: ["apply", "--target=local", `--namespace=${qaNamespace}`, `--company=${process.env.QA_COMPANY_SLUG || "default"}`, `--location=${process.env.QA_LOCATION_NAME || "Arizona Yard"}`], environment: process.env });
  qaPrepared = true;
  const account = buildQaAccountManifest(qaNamespace).find((entry) => entry.role === "admin");
  await client.authenticate({ ...account, password: qaPassword });
  const template = (await client.request("/api/office/template")).body;
  const location = template.locations[0]?.location;
  assert.ok(location?.id, "An authorized inventory location is required.");
  const token = randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  const partNumber = `ODOO-PRICE-${token}`;
  const part = (await client.request("/api/office/inventory/parts", {
    method: "POST",
    expectedStatuses: [201],
    body: { locationId: location.id, partNumber, description: "Odoo commercial pricing browser fixture", manufacturer: "", category: "", barcode: "", uomCode: "ea", trackingMode: "quantity", referenceNumbers: [] },
  })).body.part;
  const scope = (await pool.query("select company_id from parts_catalog where id=$1", [part.catalogPartId])).rows[0];
  assert.ok(scope?.company_id);
  fixture = { companyId: scope.company_id, partId: part.catalogPartId, partNumber };
  await pool.query(
    `insert into odoo_product_mappings
       (company_id,external_id,catalog_part_id,default_code,display_name,active,internal_price,internal_currency,selling_price,selling_currency,commercial_updated_at)
     values($1,$2,$3,$4,$5,true,82.7500,'USD',125.0000,'USD',now())`,
    [fixture.companyId, `qa-odoo-${token}`, fixture.partId, partNumber, `Odoo ${partNumber}`],
  );

  const providerCommercial = (await client.request(`/api/office/inventory/parts/${fixture.partId}/commercial`)).body;
  assert.equal(providerCommercial.prices.internal.current, null);
  assert.equal(providerCommercial.prices.selling.current, null);
  assert.deepEqual(
    { status: providerCommercial.odooPrices.internal.status, amount: providerCommercial.odooPrices.internal.amount, currency: providerCommercial.odooPrices.internal.currency, source: providerCommercial.odooPrices.internal.source },
    { status: "known", amount: "82.7500", currency: "USD", source: "odoo_catalog" },
  );
  assert.deepEqual(
    { status: providerCommercial.odooPrices.selling.status, amount: providerCommercial.odooPrices.selling.amount, currency: providerCommercial.odooPrices.selling.currency, source: providerCommercial.odooPrices.selling.source },
    { status: "known", amount: "125.0000", currency: "USD", source: "odoo_catalog" },
  );
  assert.equal((await pool.query("select count(*)::int count from inventory_part_price_versions where company_id=$1 and catalog_part_id=$2", [fixture.companyId, fixture.partId])).rows[0].count, 0);

  browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || "chrome", headless: true });
  const context = await browser.newContext({ storageState: await client.storageState(), viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl.origin}/?view=inventory&adminView=inventory`);
  await page.getByRole("textbox", { name: "Search inventory" }).fill(partNumber);
  await page.getByText(partNumber, { exact: true }).click();
  const header = page.locator(".inventory-part-header-price");
  await assert.doesNotReject(() => header.getByText(/125\.00/).waitFor());
  await page.getByRole("button", { name: "Prices", exact: true }).click();
  const references = page.getByText(/Odoo reference:/);
  await references.first().waitFor();
  assert.equal(await references.count(), 2);
  const referenceText = await references.allInnerTexts();
  assert.ok(referenceText.some((text) => text.includes("125.00")));
  assert.ok(referenceText.some((text) => text.includes("82.75")));
  await page.screenshot({ path: `${output}/odoo-fallback.png`, animations: "disabled" });
  assert.equal((await pool.query("select count(*)::int count from inventory_part_price_versions where company_id=$1 and catalog_part_id=$2", [fixture.companyId, fixture.partId])).rows[0].count, 0, "Viewing Odoo references must not create local price decisions.");

  await client.request(`/api/office/inventory/parts/${fixture.partId}/prices/selling`, {
    method: "PUT",
    body: { expectedVersion: 0, amount: "99.0000", currency: "USD", taxTreatment: "not_configured", taxProfileVersionId: null, reason: "QA local precedence", idempotencyKey: randomUUID() },
  });
  await page.reload();
  await page.getByRole("textbox", { name: "Search inventory" }).fill(partNumber);
  await page.getByText(partNumber, { exact: true }).click();
  await assert.doesNotReject(() => header.getByText(/99\.00/).waitFor());
  await page.getByRole("button", { name: "Prices", exact: true }).click();
  await page.getByText(/Odoo reference:.*125\.00/).waitFor();
  await page.screenshot({ path: `${output}/local-precedence.png`, animations: "disabled" });
  const localCommercial = (await client.request(`/api/office/inventory/parts/${fixture.partId}/commercial`)).body;
  assert.equal(localCommercial.prices.selling.current.amount, "99.0000");
  assert.equal(localCommercial.odooPrices.selling.amount, "125.0000");
  assert.deepEqual(pageErrors, []);
  await writeFile(`${output}/result.json`, JSON.stringify({ result: "PASS", partNumber, checks: ["Odoo internal and selling price references", "Odoo selling fallback in part header", "viewing does not create local price history", "local selling price takes precedence", "Odoo reference remains visible"] }, null, 2));
  console.log(JSON.stringify({ result: "PASS", output, partNumber }));
} finally {
  if (fixture) {
    await pool.query("delete from inventory_part_price_versions where company_id=$1 and catalog_part_id=$2", [fixture.companyId, fixture.partId]).catch(() => {});
    await pool.query("delete from odoo_product_mappings where company_id=$1 and catalog_part_id=$2", [fixture.companyId, fixture.partId]).catch(() => {});
    await pool.query("delete from parts_catalog where company_id=$1 and id=$2", [fixture.companyId, fixture.partId]).catch(() => {});
  }
  await browser?.close();
  await client.dispose();
  if (qaPrepared) await runQaAccountCommand({ argv: ["cleanup", "--target=local", `--namespace=${qaNamespace}`, `--company=${process.env.QA_COMPANY_SLUG || "default"}`, `--location=${process.env.QA_LOCATION_NAME || "Arizona Yard"}`], environment: process.env });
  await closePool();
}
