// Disposable loopback PostgreSQL; authenticated browser -> real saved Workorder APIs.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, writeFile, rm, mkdir, open } from "node:fs/promises";
import { spawn } from "node:child_process";
import pg from "pg";
import dotenv from "dotenv";
import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";
import { RoleApiClient } from "./e2e/api-client.js";

dotenv.config({ quiet: true });
const root = process.cwd();
const source = new URL((process.env.DATABASE_URL || "").replace(/^postgresql\+asyncpg:/, "postgresql:"));
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(source.hostname), "Loopback PostgreSQL required.");
const token = randomUUID().replaceAll("-", "");
const dbName = `manual_prices_browser_${token}`;
const adminUrl = new URL(source); adminUrl.pathname = "/postgres";
const isolatedUrl = new URL(source); isolatedUrl.pathname = `/${dbName}`;
const admin = new pg.Client({ connectionString: adminUrl.href });
const backendPort = Number(process.env.QA_MANUAL_PRICES_PORT || 4191);
const uiPort = Number(process.env.QA_MANUAL_PRICES_UI_PORT || 5195);
const backendUrl = new URL(`http://localhost:${backendPort}`);
const uiUrl = new URL(`http://localhost:${uiPort}`);
const output = `/tmp/workorder-manual-prices-${token}`;
await mkdir(output, { recursive: true });
const fixtureModule = `${root}/src/server/modules/workorders/.manual-prices-${token}.mjs`;
const htmlPath = `${root}/frontend/.manual-prices-${token}.html`;
const jsxPath = `${root}/frontend/.manual-prices-${token}.jsx`;
let child, vite, browser, pool, serverLog, dbCreated = false;
const clients = [];
await admin.connect();
try {
  await admin.query(`create database "${dbName}"`); dbCreated = true;
  Object.assign(process.env, { DATABASE_URL: isolatedUrl.href, NODE_ENV: "test", PORT: String(backendPort),
    BETTER_AUTH_URL: backendUrl.origin, AUTH_TRUSTED_ORIGINS: uiUrl.origin,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), QA_ACCOUNT_PASSWORD: randomBytes(24).toString("hex"),
    RUN_POSTGRES_INTEGRATION: "", SAMSARA_SYNC_ON_STARTUP: "false" });
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
  const { readCreatePricing } = await import("../../src/server/db/repositories/workorder-create-pricing.repo.js");
  const { createOperationalWorkorder } = await import("../../src/server/db/repositories/operational-workorders.repo.js");
  const preview = await readCreatePricing(fixture.input);
  const workorder = await createOperationalWorkorder({ ...fixture.input, pricing: { ...fixture.input.pricing, expectedFingerprint: preview.fingerprint } });
  await pool.query("update operational_workorders set status='accepted' where id=$1", [workorder.id]);
  // Seed an installed fixture row so the production detail projection includes it.
  await pool.query("update workorder_serialized_part_usages set status='installed_pending_approval',finalized_by_user_id=$2,finalized_at=now(),finalize_idempotency_key=$3,finalize_request_hash=$4 where workorder_id=$1",[workorder.id,fixture.actorId,randomUUID(),'f'.repeat(64)]);
  await pool.query("update inventory_serialized_units set status='installed_pending_approval' where id=$1",[fixture.serializedUnitId]);
  const company = (await pool.query("select slug from companies where id=$1", [fixture.companyId])).rows[0];
  const shop = (await pool.query("select name from locations where id=$1", [fixture.locationId])).rows[0];
  const { runQaAccountCommand } = await import("./manage-qa-accounts.js");
  await runQaAccountCommand({ argv: ["apply", "--target=local", "--namespace=manual-prices", `--company=${company.slug}`, `--location=${shop.name}`], logger: { log() {} } });
  await closePool(); pool = getPool();
  serverLog = await open(`${output}/server.log`, "w");
  child = spawn(process.execPath, ["server.js"], { cwd: root, env: process.env, stdio: ["ignore", serverLog.fd, serverLog.fd] });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(backendUrl)).ok) { ready = true; break; } } catch {}
    if (child.exitCode !== null) throw new Error(`Isolated server exited; inspect ${output}/server.log`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Isolated server readiness timeout; inspect ${output}/server.log`);
  const actors = {};
  for (const role of ["admin", "office", "mechanic"]) {
    const client = await RoleApiClient.create({ role, baseUrl: backendUrl, timeoutMs: 15000 }); clients.push(client);
    await client.authenticate({ username: `manual_prices.${role}`, password: process.env.QA_ACCOUNT_PASSWORD }); actors[role] = client;
  }
  const subject = { id: workorder.id, locationId: fixture.locationId, laborProductId: fixture.laborProductId };
  await writeFile(htmlPath, `<html><body><div id="root"></div><script type="module" src="/.manual-prices-${token}.jsx"></script></body></html>`);
  await writeFile(jsxPath, `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
import './src/styles.css';import{api}from'./src/lib/api.js';
import{WorkorderPartPriceCell}from'./src/components/workorders/WorkorderPartPriceCell.jsx';
import{LaborPriceCell}from'./src/components/workorders/LaborPriceCell.jsx';
const f=${JSON.stringify(subject)};
function App(){const[d,setD]=useState(null),[error,setError]=useState('');async function refresh(){const r=await api('/api/workorders/'+f.id+'/modules');setD(r);window.detail=r;}useEffect(()=>{refresh().catch(e=>setError(e.message));},[]);if(!d)return <p>{error||'Loading'}</p>;const p=d.modules.parts.data,l=d.modules.diagnosisRepair.data;return <main><h1>Saved Workorder prices</h1>{p.installedSerializedParts.map(u=><section data-testid="serialized" key={u.usageId}><WorkorderPartPriceCell workorderId={f.id} usageKind="serialized" usageId={u.usageId} catalogPartId={u.catalogPartId} locationId={f.locationId} price={u.price} quantity="1" onChanged={refresh}/></section>)}{p.aggregatePartUsages.map(u=><section data-testid="aggregate" key={u.id}><WorkorderPartPriceCell workorderId={f.id} usageKind="aggregate" usageId={u.id} catalogPartId={u.catalogPartId} locationId={f.locationId} price={u.price} quantity={u.effectiveQuantity} costAllocations={u.costAllocations} onChanged={refresh}/></section>)}<section data-testid="labor"><LaborPriceCell workorderId={f.id} locationId={f.locationId} productId={f.laborProductId} hours={l.formData.laborHours} price={l.laborPrice} currentRates={l.currentLaborRates} onChanged={refresh}/></section><button onClick={refresh}>Reload saved data</button><pre data-testid="activity">{JSON.stringify(d.modules.activity.data.timeline)}</pre></main>};createRoot(document.getElementById('root')).render(<App/>);`);
  vite = await createViteServer({ configFile: `${root}/frontend/vite.config.js`, server: { host: "localhost", port: uiPort, strictPort: true, proxy: { "/api": { target: backendUrl.origin, changeOrigin: false } } } });
  await vite.listen(); browser = await chromium.launch({ headless: true });
  const count = async () => Number((await pool.query("select count(*) n from workorder_field_events where workorder_id=$1 and field_key like 'pricing.%'", [workorder.id])).rows[0].n);
  for (const role of ["admin", "office"]) {
    const context = await browser.newContext({ storageState: await actors[role].storageState(), viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on("pageerror", error => console.error(`Client error: ${error.message}`));
    await page.goto(`${uiUrl.origin}/.manual-prices-${token}.html`);
    await page.waitForFunction(()=>window.detail);
    await writeFile(`${output}/${role}-initial-detail.json`,JSON.stringify(await page.evaluate(()=>window.detail),null,2));
    for (const kind of ["serialized", "aggregate", "labor"]) {
      const cell = page.getByTestId(kind); const input = cell.getByRole("textbox", { name: kind === "labor" ? "Labor unit price" : "Part unit price", exact: true });
      await input.waitFor(); await page.waitForFunction(({kind})=>!document.querySelector('[data-testid="'+kind+'"] input').readOnly,{kind});
      for (const [value, trigger] of [["12.3456", "enter"], ["0", "blur"]]) {
        const before = await count();
        await input.fill(value);
        const response = page.waitForResponse(r=>r.url().includes(`/modules/${kind === "labor" ? "diagnosisRepair" : "parts"}/actions/record`) && r.request().postDataJSON()?.operation === (kind === "labor" ? "laborPriceSelection" : "partPriceSelection"));
        if (trigger === "enter") await input.press("Enter"); else await page.getByRole("heading").click();
        assert.equal((await response).status(),200);
        await page.waitForFunction(({kind,value})=>Number(document.querySelector('[data-testid="'+kind+'"] input').value)===Number(value),{kind,value});
        assert.equal(await count(),before+1);
        await page.reload(); await input.waitFor(); assert.equal(Number(await input.inputValue()),Number(value));
      }
      const before = await count(); await input.fill("-1"); await input.press("Enter");
      await cell.getByRole("alert").filter({hasText:"four decimal"}).waitFor(); assert.equal(await count(),before);
      await input.fill("0.12345"); await input.press("Enter"); await cell.getByRole("alert").filter({hasText:"four decimal"}).waitFor(); assert.equal(await count(),before);
      await page.reload();
      // Fail exactly one save at transport boundary, then retry through the real API.
      await page.route("**/modules/*/actions/record", async route=>{
        if(route.request().postDataJSON()?.customUnitPrice === "8.7654") { await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"QA temporary save failure"})}); await page.unroute("**/modules/*/actions/record"); }
        else await route.continue();
      });
      await input.fill("8.7654"); await input.press("Enter"); await cell.getByRole("alert").filter({hasText:"QA temporary save failure"}).waitFor(); assert.equal(await count(),before);
      const retry=page.waitForResponse(r=>r.request().postData()?.includes('"customUnitPrice":"8.7654"')&&r.status()===200);
      await input.focus(); await page.getByRole("heading").click(); await retry;
      await page.reload(); await input.waitFor(); assert.equal(Number(await input.inputValue()),8.7654);
      const beforeLost=await count();const lostKeys=[];
      await page.route("**/modules/*/actions/record",async route=>{
        if(route.request().postDataJSON()?.customUnitPrice === "9.8765") {
          lostKeys.push(route.request().postDataJSON().idempotencyKey);
          const response=await route.fetch();assert.equal(response.status(),200);
          await route.abort("failed");await page.unroute("**/modules/*/actions/record");
        } else await route.continue();
      });
      await input.fill("9.8765");await input.press("Enter");await cell.getByRole("alert").waitFor();assert.equal(await count(),beforeLost+1);
      const lostRetry=page.waitForResponse(r=>r.request().postData()?.includes('"customUnitPrice":"9.8765"')&&r.status()===200);
      await input.focus();await page.getByRole("heading").click();const retriedResponse=await lostRetry;
      assert.equal(retriedResponse.request().postDataJSON().idempotencyKey,lostKeys[0]);assert.equal(await count(),beforeLost+1);
      await page.reload();await input.waitFor();assert.equal(Number(await input.inputValue()),9.8765);
      console.log(`PASS ${role} ${kind}: four decimals, zero, Enter/blur, persisted reload, invalid input, failure/retry, lost response retry emits one event`);
    }
    const detail=(await actors[role].request(`/api/workorders/${workorder.id}/modules`)).body;
    const events=detail.modules.activity.data.timeline.filter(e=>String(e.field_key).startsWith("pricing.")&&e.actor_user_id===actors[role].actor.id);
    assert.equal(events.length,12); for(const event of events){assert.ok(event.changed_by_name);assert.ok(!Number.isNaN(Date.parse(event.created_at)));assert.ok(event.new_value);assert.ok(event.old_value);}
    await page.screenshot({path:`${output}/${role}-completed.png`,fullPage:true}); await context.close();
    console.log(`PASS ${role} real protected activity: 12 price writes include actor name/id, timestamp, old/new price`);
  }
  const partUsage=(await actors.admin.request(`/api/workorders/${workorder.id}/modules`)).body.modules.parts.data.installedSerializedParts[0];
  const mutation={operation:"partPriceSelection",usageKind:"serialized",usageId:partUsage.usageId,selection:"batch_cost",customUnitPrice:"1",expectedFingerprint:"a".repeat(64),reason:"Unauthorized price attempt",idempotencyKey:randomUUID()};
  const beforeDenied=await count();
  for(const moduleKey of ["parts","diagnosisRepair"]){await actors.mechanic.request(`/api/workorders/${workorder.id}/modules/${moduleKey}/actions/record`,{method:"POST",body:moduleKey==="parts"?mutation:{operation:"laborPriceSelection",selection:"internal_cost",customUnitPrice:"1",reason:"Unauthorized",idempotencyKey:randomUUID()},expectedStatuses:[403,404]});}
  const foreign=await createFixture();const foreignPreview=await readCreatePricing(foreign.input);const foreignWorkorder=await createOperationalWorkorder({...foreign.input,pricing:{...foreign.input.pricing,expectedFingerprint:foreignPreview.fingerprint}});
  await actors.office.request(`/api/workorders/${foreignWorkorder.id}/modules/parts/actions/record`,{method:"POST",body:mutation,expectedStatuses:[403,404]});
  const otherLocation=randomUUID();await pool.query("insert into locations(id,company_id,name) values($1,$2,'Foreign location QA')",[otherLocation,fixture.companyId]);
  const otherAsset=randomUUID();await pool.query("insert into assets(id,company_id,location_id,provider,name,unit_no) values($1,$2,$3,'manual','Foreign location truck','FOREIGN')",[otherAsset,fixture.companyId,otherLocation]);
  const locationWorkorder=await createOperationalWorkorder({...fixture.input,locationId:otherLocation,assetId:otherAsset,formData:{parts:[],laborHours:"",laborProduct:null},inventoryUnitSelections:[],inventoryPositionSelections:[],pricing:undefined});
  await actors.office.request(`/api/workorders/${locationWorkorder.id}/modules/parts/actions/record`,{method:"POST",body:mutation,expectedStatuses:[403,404]});
  assert.equal(await count(),beforeDenied);
  console.log("PASS mechanic part/labor and Office foreign company/location mutations rejected without price events");
  console.log(`Browser/API manual price gate passed; evidence ${output}`);
} finally {
  await browser?.close(); await vite?.close(); for(const client of clients)await client.dispose();
  if(child&&child.exitCode===null){child.kill("SIGTERM");await new Promise(resolve=>{child.once("exit",resolve);setTimeout(resolve,5000);});}
  await serverLog?.close(); if(pool)await pool.end().catch(()=>{});
  for(const file of [fixtureModule,htmlPath,jsxPath])await rm(file,{force:true});
  if(dbCreated)await admin.query(`drop database "${dbName}" with (force)`);await admin.end();
}
