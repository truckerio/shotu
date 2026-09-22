import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { getPool, closePool } from "../../src/server/db/pool.js";
import { RoleApiClient } from "./e2e/api-client.js";
import { runQaAccountCommand } from "./manage-qa-accounts.js";
import { buildQaAccountManifest } from "./account-manifest.js";
import { assertQaTargetSafety, redactQaError } from "./safety.js";

const LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const required = (name) => { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`${name} is required.`); return value; };

function config() {
  const safety = assertQaTargetSafety({ environment: process.env, options: { target: process.env.QA_TARGET_ENVIRONMENT } });
  const baseUrl = new URL(process.env.QA_INBOUND_BASE_URL || "http://localhost:4173");
  const database = new URL(required("DATABASE_URL"));
  if (safety.production || !LOCAL.has(baseUrl.hostname) || !LOCAL.has(database.hostname)) throw new Error("Inbound browser QA only runs against local app and database.");
  const password = required("QA_ACCOUNT_PASSWORD");
  if (password.length < 12) throw new Error("QA_ACCOUNT_PASSWORD must be at least 12 characters.");
  return { baseUrl, password, namespace: required("QA_ACCOUNT_NAMESPACE"), companySlug: process.env.QA_COMPANY_SLUG || "default", locationName: required("QA_LOCATION_NAME") };
}

function draft(number, partId, poNumber = "") {
  return { documentType: { value: "invoice" }, vendorName: { value: "Inbound QA Vendor" }, vendorAccount: { value: "" }, invoiceNumber: { value: number }, purchaseOrderNumber: { value: poNumber }, currency: { value: "USD" }, lines: [{ id: "line-1", catalogPartId: partId, partNumber: { value: "INBOUND-QA" }, quantity: { value: 2 }, unitOfMeasure: { value: "ea" } }], warnings: [] };
}

async function fixture(pool, { companySlug, locationName, actorId }) {
  const run = randomUUID().replaceAll("-", "");
  const scope = await pool.query(`select company.id company_id, location.id location_id from companies company join locations location on location.company_id=company.id where company.slug=$1 and company.active=true and location.active=true and lower(location.name)=lower($2) limit 1`, [companySlug, locationName]);
  if (!scope.rows[0]) throw new Error("QA company/location was not found.");
  const { company_id: companyId, location_id: locationId } = scope.rows[0];
  const ids = Object.fromEntries(["supplier", "part", "expectedOrder", "expectedLine", "completeOrder", "completeLine", "allocatedInvoice", "unmatchedInvoice", "directReceipt", "directLine", "allocation"].map((name) => [name, randomUUID()]));
  const expectedNumber = `PO-INBOUND-${run.slice(0, 10)}`;
  try {
    await pool.query("insert into inventory_suppliers(id,company_id,name) values($1,$2,$3)", [ids.supplier, companyId, `Inbound QA Vendor ${run.slice(0, 8)}`]);
    await pool.query("insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values($1,$2,$3,$4,$5,'ea','quantity')", [ids.part, companyId, `INBOUND-QA-${run.slice(0, 10)}`, `INBOUNDQA${run.slice(0, 10)}`, `Inbound browser fixture ${run}`]);
    await pool.query("insert into inventory_purchase_orders(id,company_id,location_id,supplier_id,created_by,number,currency,status) values($1,$2,$3,$4,$5,$6,'USD','ordered'),($7,$2,$3,$4,$5,$8,'USD','received')", [ids.expectedOrder, companyId, locationId, ids.supplier, actorId, expectedNumber, ids.completeOrder, `PO-COMPLETE-${run.slice(0, 10)}`]);
    await pool.query("insert into inventory_purchase_lines(id,company_id,order_id,catalog_part_id,part_number,description,uom_code,quantity,received_quantity,tracking_mode) values($1,$2,$3,$4,'INBOUND-QA','Expected PO line','ea',2,0,'quantity'),($5,$2,$6,$4,'INBOUND-QA','Completed PO line','ea',2,2,'quantity')", [ids.expectedLine, companyId, ids.expectedOrder, ids.part, ids.completeLine, ids.completeOrder]);
    await pool.query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at)
      values($1,$2,$3,$4,$4,$5,$6,'application/pdf',1,$7,'reviewed','qa','qa','qa',$8::jsonb,now()),($9,$2,$3,$4,$4,$10,$11,'application/pdf',1,$12,'reviewed','qa','qa','qa',$13::jsonb,now())`, [ids.allocatedInvoice, companyId, locationId, actorId, hash(`allocated-${run}`), `allocated-${run}.pdf`, `allocated-${run}`, JSON.stringify(draft(`INV-A-${run.slice(0, 8)}`, ids.part, expectedNumber)), ids.unmatchedInvoice, hash(`unmatched-${run}`), `unmatched-${run}.pdf`, `unmatched-${run}`, JSON.stringify(draft(`INV-U-${run.slice(0, 8)}`, ids.part))]);
    await pool.query("insert into inventory_purchase_invoice_allocations(id,company_id,invoice_run_id,invoice_line_index,purchase_line_id,quantity,status,request_hash,created_by) values($1,$2,$3,0,$4,2,'planned',$5,$6)", [ids.allocation, companyId, ids.allocatedInvoice, ids.expectedLine, hash(`allocation-${run}`), actorId]);
    return { companyId, locationId, ids, expectedNumber, run };
  } catch (error) { await cleanupFixture(pool, { companyId, ids }); throw error; }
}

async function cleanupFixture(pool, fixture) {
  if (!fixture?.companyId) return;
  const { companyId, ids = {} } = fixture;
  const values = Object.values(ids).filter(Boolean);
  const client = await pool.connect();
  try {
    await client.query("begin"); await client.query("set local app.allow_inventory_evidence_teardown='on'");
    await client.query("delete from inventory_purchase_invoice_allocations where company_id=$1 and id=any($2::uuid[])", [companyId, values]);
    await client.query("delete from invoice_extraction_runs where company_id=$1 and id=any($2::uuid[])", [companyId, [ids.allocatedInvoice, ids.unmatchedInvoice].filter(Boolean)]);
    await client.query("delete from inventory_purchase_lines where company_id=$1 and id=any($2::uuid[])", [companyId, [ids.expectedLine, ids.completeLine].filter(Boolean)]);
    await client.query("delete from inventory_purchase_orders where company_id=$1 and id=any($2::uuid[])", [companyId, [ids.expectedOrder, ids.completeOrder].filter(Boolean)]);
    await client.query("delete from parts_catalog where company_id=$1 and id=$2", [companyId, ids.part]);
    await client.query("delete from inventory_suppliers where company_id=$1 and id=$2", [companyId, ids.supplier]);
    await client.query("commit");
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

async function runBrowser({ baseUrl, client, expectedNumber }) {
  const browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || "chrome", headless: true });
  const results = [];
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ storageState: await client.storageState(), viewport });
      const page = await context.newPage(); const errors = []; const apiErrors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("response", (response) => { if (response.url().includes("/api/office/inventory/inbound") && !response.ok()) apiErrors.push(`${response.status()} ${response.url()}`); });
      await page.goto(new URL("/?view=inventory&adminView=inventory", baseUrl).href, { waitUntil: "domcontentloaded" });
      const shell = page.locator("main");
      const sectionHeader = shell.locator(".operational-collection-section-header");
      await sectionHeader.getByRole("heading", { name: "Stock", exact: true }).waitFor();
      const order = [await sectionHeader.getByRole("heading").textContent(), ...await sectionHeader.getByRole("navigation").getByRole("button").allTextContents()].map((label) => label.trim());
      assert.deepEqual(order, ["Stock", "Inbound", "Purchasing", "Tasks", "Reports"]);
      await sectionHeader.getByRole("button", { name: "Inbound", exact: true }).focus(); await page.keyboard.press("Enter");
      const views = page.getByRole("group", { name: "Inbound views" });
      await views.waitFor();
      const viewButton = (name) => views.getByRole("button").filter({ hasText: new RegExp(`^${name}`) });
      for (const name of ["My work", "Expected", "Needs attention", "Complete"]) await viewButton(name).waitFor();
      await page.getByRole("button", { name: "Inbound shop" }).waitFor(); await page.getByLabel("Search inbound work").waitFor();
      await viewButton("Complete").click();
      await page.getByText(/PO-COMPLETE-/).first().waitFor();
      await viewButton("Needs attention").click();
      await page.getByText(/INV-U-/).first().waitFor();
      await page.getByText(/PO decision needed/).first().waitFor();
      await viewButton("Expected").click();
      await page.getByText(expectedNumber, { exact: false }).first().waitFor();
      await page.getByText(expectedNumber, { exact: false }).first().click();
      await page.getByRole("button", { name: "Receive PO", exact: true }).click();
      const receiptDialog = page.getByRole("dialog", { name: "Receive purchase order" });
      await receiptDialog.getByRole("heading", { name: `Receive ${expectedNumber}` }).waitFor(); await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Inbound", exact: true }).click();
      await viewButton("My work").click();
      await page.getByText(/PO decision needed/).first().waitFor();
      await page.getByText(/INV-U-/).first().click(); await page.getByRole("button", { name: "Open invoice", exact: true }).click();
      await page.waitForURL(/invoiceRun=/); await page.locator(".inventory-workspace.is-invoice-workflow").waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `Horizontal overflow at ${viewport.width}px`);
      assert.deepEqual(errors, [], `Page errors at ${viewport.width}px`); assert.deepEqual(apiErrors, [], `Inbound API errors at ${viewport.width}px`);
      results.push(`${viewport.width}x${viewport.height}`); await context.close();
    }
  } finally { await browser.close(); }
  return results;
}

async function main() {
  const settings = config(); const pool = getPool(); let fixtureData; let client;
  try {
    await runQaAccountCommand({ argv: ["apply", "--target=local", `--namespace=${settings.namespace}`], environment: process.env });
    const account = buildQaAccountManifest(settings.namespace).find((entry) => entry.role === "admin");
    client = await RoleApiClient.create({ role: "admin", baseUrl: settings.baseUrl, timeoutMs: 15_000 }); await client.authenticate({ ...account, password: settings.password });
    fixtureData = await fixture(pool, { ...settings, actorId: client.actor.id });
    const results = await runBrowser({ ...settings, client, expectedNumber: fixtureData.expectedNumber });
    console.log(JSON.stringify({ passed: true, viewports: results, fixtureCleanup: "pending" }));
  } finally {
    await cleanupFixture(pool, fixtureData); await client?.dispose().catch(() => {});
    await runQaAccountCommand({ argv: ["cleanup", "--target=local", `--namespace=${settings.namespace}`], environment: process.env }).catch((error) => console.error(redactQaError(error, [settings?.password])));
    await closePool().catch(() => {});
  }
}

main().catch((error) => { console.error(redactQaError(error, [process.env.QA_ACCOUNT_PASSWORD])); process.exitCode = 1; });
