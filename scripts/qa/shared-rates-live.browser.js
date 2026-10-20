// Isolated local PostgreSQL + authenticated real API/component workflow.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, writeFile, rm, mkdir, open } from "node:fs/promises";
import { spawn } from "node:child_process";
import pg from "pg";
import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";
import { RoleApiClient } from "./e2e/api-client.js";

const root = process.cwd();
const source = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(source.hostname), "Loopback PostgreSQL required.");
const dbName = `shared_rates_browser_${randomUUID().replaceAll("-", "")}`;
const adminUrl = new URL(source); adminUrl.pathname = "/postgres";
const isolatedUrl = new URL(source); isolatedUrl.pathname = `/${dbName}`;
const admin = new pg.Client({ connectionString: adminUrl.href });
const backendPort = Number(process.env.QA_SHARED_RATES_PORT || 4188);
const uiPort = Number(process.env.QA_SHARED_RATES_UI_PORT || 5192);
const backendUrl = new URL(`http://localhost:${backendPort}`);
const uiUrl = new URL(`http://localhost:${uiPort}`);
const output = `/tmp/shared-rates-live-${Date.now()}`;
await mkdir(output, { recursive: true });
let child, vite, browser, client, mechanicClient, pool, dbCreated = false;
const fixtureModule = `${root}/src/server/modules/workorders/.shared-rates-live-fixture.mjs`;
const htmlPath = `${root}/frontend/.shared-rates-live.html`;
const jsxPath = `${root}/frontend/.shared-rates-live.jsx`;
await admin.connect();
try {
  await admin.query(`create database "${dbName}"`); dbCreated = true;
  Object.assign(process.env, {
    DATABASE_URL: isolatedUrl.href, NODE_ENV: "test", PORT: String(backendPort),
    BETTER_AUTH_URL: backendUrl.origin, AUTH_TRUSTED_ORIGINS: uiUrl.origin,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), QA_ACCOUNT_PASSWORD: randomBytes(24).toString("hex"),
    RUN_POSTGRES_INTEGRATION: "", SAMSARA_SYNC_ON_STARTUP: "false",
  });
  const { migrate } = await import("../../src/server/db/migrate.js");
  await migrate();
  const { getPool, closePool } = await import("../../src/server/db/pool.js");
  pool = getPool();
  const testSource = await readFile(`${root}/src/server/modules/workorders/workorder-create-pricing.integration.test.js`, "utf8");
  const fixtureSource = testSource.slice(0, testSource.indexOf("async function cleanupFixture"))
    .replace(/after\(async \(\) => \{ if \(enabled\) await closePool\(\); \}\);/, "");
  await writeFile(fixtureModule, `${fixtureSource}\nexport { createFixture };\n`);
  const { createFixture } = await import(fixtureModule);
  const fixture = await createFixture({ aggregateSelection: "selling_price" });
  const company = (await pool.query("select slug from companies where id=$1", [fixture.companyId])).rows[0];
  const shop = (await pool.query("select name from locations where id=$1", [fixture.locationId])).rows[0];
  const { runQaAccountCommand } = await import("./manage-qa-accounts.js");
  await runQaAccountCommand({ argv: ["apply", "--target=local", "--namespace=shared-rates-live", `--company=${company.slug}`, `--location=${shop.name}`], logger: { log() {} } });
  const { createOperationalWorkorder } = await import("../../src/server/db/repositories/operational-workorders.repo.js");
  const workorder = await createOperationalWorkorder({ ...fixture.input, formData: { ...fixture.input.formData, parts: [], laborHours: "", laborProduct: null }, inventoryUnitSelections: [], inventoryPositionSelections: [], pricing: undefined });
  await pool.query("update operational_workorders set status='accepted' where id=$1", [workorder.id]);
  const selling = await import("../../src/server/db/repositories/inventory-selling-policies.repo.js");
  await selling.appendInventorySellingPolicy({ catalogPartId: fixture.serializedPartId, locationId: fixture.locationId,
    expectedVersion: 0, method: "fixed", value: "90", currency: "USD", reason: "Browser test selling rate",
    companyIds: [fixture.companyId], locationIds: [fixture.locationId], isAdmin: true, actorId: fixture.actorId,
    idempotencyKey: randomUUID(), requestHash: "b".repeat(64) });
  await closePool(); pool = getPool();
  const serverLog = await open(`${output}/server.log`, "w");
  child = spawn(process.execPath, ["server.js"], { cwd: root, env: process.env, stdio: ["ignore", serverLog.fd, serverLog.fd] });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(backendUrl)).ok) break; } catch {}
    if (child.exitCode !== null) throw new Error("Isolated server exited; inspect local server log.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  client = await RoleApiClient.create({ role: "admin", baseUrl: backendUrl, timeoutMs: 15000 });
  await client.authenticate({ username: "shared_rates_live.admin", password: process.env.QA_ACCOUNT_PASSWORD });
  mechanicClient = await RoleApiClient.create({ role: "mechanic", baseUrl: backendUrl, timeoutMs: 15000 });
  await mechanicClient.authenticate({ username: "shared_rates_live.mechanic", password: process.env.QA_ACCOUNT_PASSWORD });
  const denied = await mechanicClient.request(`/api/labor-products/${fixture.laborProductId}/rates?locationId=${fixture.locationId}`, { expectedStatuses: [403] });
  assert.ok(denied.body?.code);
  const subject = { workorderId: workorder.id, locationId: fixture.locationId, serialPartId: fixture.serializedPartId,
    serialUnitId: fixture.serializedUnitId, aggregatePartId: fixture.aggregatePartId, laborProductId: fixture.laborProductId };
  await writeFile(htmlPath, '<html><style>html,body,#root{height:100%;margin:0;overflow:hidden}.qa-content{height:100%;overflow:auto;padding:20px;box-sizing:border-box}</style><body><div id="root"></div><script type="module" src="/.shared-rates-live.jsx"></script></body></html>');
  await writeFile(jsxPath, `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import './src/styles.css';import './src/typography.css';import './src/components/forms/operational-form.css';
import{PartCommercialDetails}from'./src/features/inventory/PartCommercialDetails.jsx';
import{WorkorderSerializedPartDialog}from'./src/components/workorders/part-requests/WorkorderSerializedPartDialog.jsx';
import{MeasuredPartUsageDialog}from'./src/components/workorders/part-requests/MeasuredPartUsageDialog.jsx';
import{WorkorderPartPriceCell}from'./src/components/workorders/WorkorderPartPriceCell.jsx';
import{CreateLaborPriceCell}from'./src/features/workorder-modules/parts/CreateWorkorderPriceCell.jsx';
const f=${JSON.stringify(subject)};
function App(){const[serial,setSerial]=useState(false),[measured,setMeasured]=useState(false),[usage,setUsage]=useState(null),[revision,setRevision]=useState(0);return <div className="prototype qa-content"><h1>Shared rates live QA</h1>
<PartCommercialDetails key={revision} part={{catalogPartId:f.serialPartId,partNumber:'SERIAL TEST',uomCode:'ea',trackingMode:'serialized'}} location={{locationId:f.locationId,locationName:'Test shop'}} onChanged={()=>setRevision(v=>v+1)}/>
<button onClick={()=>setSerial(true)}>Choose serial</button><button onClick={()=>setMeasured(true)}>Choose quantity</button>
<CreateLaborPriceCell productId={f.laborProductId} locationId={f.locationId} laborLabel="QA labor" previewStatus="ready" onChange={()=>{}}/>
{serial?<WorkorderSerializedPartDialog open canViewPrices workorderId={f.workorderId} locationId={f.locationId} catalogPart={{id:f.serialPartId,partNumber:'SERIAL TEST',uomCode:'ea'}} onClose={()=>setSerial(false)} onReserved={(u,r)=>{setUsage({...u,price:r.price});window.addedUsage=u;}}/>:null}
{measured?<MeasuredPartUsageDialog open canViewPrices allowStockIntake={false} suggestionsEnabled={false} workorderId={f.workorderId} locationId={f.locationId} catalogPart={{id:f.aggregatePartId,partNumber:'QUANTITY TEST',uomCode:'ea',canonicalUomCode:'ea',trackingMode:'quantity'}} onClose={()=>setMeasured(false)} onReserved={(u)=>{window.addedAggregate=u;}}/>:null}
{usage?<WorkorderPartPriceCell workorderId={f.workorderId} usageKind="serialized" usageId={usage.id} catalogPartId={f.serialPartId} locationId={f.locationId} partLabel="SERIAL TEST" uomCode="ea" price={usage.price} quantity="1"/>:null}</div>};createRoot(document.getElementById('root')).render(<App/>);`);
  vite = await createViteServer({ configFile: `${root}/frontend/vite.config.js`, server: { host: "localhost", port: uiPort, strictPort: true, proxy: { "/api": { target: backendUrl.origin, changeOrigin: false } } } });
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: await client.storageState(), viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => console.error(`Client error: ${error.message}`));
  await page.goto(`${uiUrl.origin}/.shared-rates-live.html`);
  await page.getByRole("button", { name: "Set rates", exact: true }).click();
  const rates = page.getByRole("dialog", { name: "Set rates", exact: true });
  await rates.getByLabel("Amount", { exact: true }).fill("95");
  await rates.getByLabel("Reason", { exact: true }).fill("Browser verified selling rate");
  await rates.getByRole("button", { name: "Save", exact: true }).click();
  await rates.waitFor({ state: "hidden" });
  console.log("PASS real API Stock Set rates save");
  await page.getByRole("button", { name: "Choose serial", exact: true }).click();
  const picker = page.locator(".serialized-unit-nested-dropdown");
  await picker.getByRole("checkbox").first().check();
  await picker.locator('button[aria-label="Price source"]').click();
  const selectedOption = page.getByRole("option", { name: /Selling price.*95/ });
  await selectedOption.click();
  await picker.getByRole("button", { name: /Use selected units/ }).click();
  await picker.waitFor({ state: "hidden" });
  await page.waitForFunction(() => Boolean(window.addedUsage));
  const serialSnapshot = (await pool.query("select unit_price,selection from workorder_part_price_snapshots where workorder_id=$1 and serialized_usage_id=$2 order by created_at desc limit 1", [workorder.id, await page.evaluate(() => window.addedUsage.id)])).rows[0];
  assert.equal(serialSnapshot.selection, "selling_price"); assert.equal(Number(serialSnapshot.unit_price), 95);
  console.log("PASS real serial preview -> selection -> atomic price snapshot");
  const savedCell = page.locator(".workorder-part-price");
  await savedCell.locator('button[aria-label="Price source"]').click();
  const savedOption = page.getByRole("option", { name: /Selling price.*95/ });
  await savedOption.waitFor();
  assert.equal(await savedOption.locator(".dropdown-select-check").count(), 0);
  assert.equal(await savedOption.getAttribute("data-selected"), "true");
  await page.getByRole("option", { name: "Set rates…", exact: true }).click();
  const savedRates = page.getByRole("dialog", { name: "Set rates", exact: true });
  await savedRates.getByLabel("Amount", { exact: true }).fill("100");
  await savedRates.getByLabel("Reason", { exact: true }).fill("Update configured rate without repricing saved work");
  await savedRates.getByRole("button", { name: "Save", exact: true }).click();
  await savedRates.waitFor({ state: "hidden" });
  const unchanged = (await pool.query("select count(*)::int count from workorder_part_price_snapshots where workorder_id=$1", [workorder.id])).rows[0];
  assert.equal(unchanged.count, 1);
  await savedCell.locator('button[aria-label="Price source"]').click();
  await page.getByRole("option", { name: /Selling price.*100/ }).click();
  await savedCell.getByText("$100.00", { exact: true }).first().waitFor();
  const revised = (await pool.query("select unit_price from workorder_part_price_snapshots where workorder_id=$1 order by created_at", [workorder.id])).rows;
  assert.deepEqual(revised.map((row) => Number(row.unit_price)), [95, 100]);
  console.log("PASS saved Workorder rates save preserves snapshot; explicit same-source reselect appends new snapshot");
  await page.locator('.create-labor-price-cell button[aria-label="Price source"]').click();
  await page.getByRole("option", { name: "Set rates…", exact: true }).click();
  const laborRates = page.getByRole("dialog", { name: "Set rates", exact: true });
  await laborRates.getByLabel("Amount", { exact: true }).fill("125");
  await laborRates.getByLabel("Reason", { exact: true }).fill("Create labor rate from shared dialog");
  await laborRates.getByRole("button", { name: "Save", exact: true }).click();
  await laborRates.waitFor({ state: "hidden" });
  const currentLabor = await client.request(`/api/labor-products/${fixture.laborProductId}/rates?locationId=${fixture.locationId}`);
  assert.equal(Number(currentLabor.body.currentRates.selling_price.amount), 125);
  console.log("PASS real Create labor shared rates GET/PUT");
  await page.reload();
  const persisted = (await pool.query("select count(*)::int count from workorder_part_price_snapshots where workorder_id=$1", [workorder.id])).rows[0]; assert.equal(persisted.count, 2);
  await page.getByRole("button", { name: "Choose quantity", exact: true }).click();
  const measured = page.locator(".measured-part-dialog");
  await measured.getByRole("radio").first().check();
  await measured.locator('button[aria-label="Price source"]').click();
  await page.getByRole("option", { name: /Internal price/ }).click();
  await measured.getByRole("button", { name: "Reserve material", exact: true }).click();
  await measured.waitFor({ state: "hidden" });
  const aggregateSnapshot = (await pool.query("select selection,configured_price_version_id from workorder_part_price_snapshots where workorder_id=$1 and aggregate_usage_id is not null", [workorder.id])).rows[0];
  assert.equal(aggregateSnapshot.selection, "internal_cost"); assert.ok(aggregateSnapshot.configured_price_version_id);
  console.log("PASS real quantity allocation preview -> internal source -> atomic price snapshot");
  await page.screenshot({ path: `${output}/completed.png` });
  console.log(`Live browser/API gate passed; evidence ${output}`);
} finally {
  await browser?.close(); await vite?.close();
  await client?.dispose?.(); await mechanicClient?.dispose?.();
  if (child && child.exitCode === null) { child.kill("SIGTERM"); await new Promise((resolve) => { child.once("exit", resolve); setTimeout(resolve, 5000); }); }
  if (pool) await pool.end().catch(() => {});
  for (const file of [fixtureModule, htmlPath, jsxPath]) await rm(file, { force: true });
  if (dbCreated) await admin.query(`drop database "${dbName}" with (force)`);
  await admin.end();
}
