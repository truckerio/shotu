// Authenticated Stock navigation against real endpoints and a disposable PostgreSQL database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const database = new URL(process.env.DATABASE_URL || '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) || !/^\/inspection_maintenance_test_[a-f0-9]{32}$/.test(database.pathname)) throw new Error('Requires the runner disposable loopback database');
const port = Number(process.env.QA_BATCH_NAVIGATION_PORT || 4204);
const baseUrl = `http://localhost:${port}`;
const artifacts = await mkdtemp(join(tmpdir(), 'batch-navigation-'));
Object.assign(process.env, { PORT: String(port), BETTER_AUTH_URL: baseUrl, AUTH_TRUSTED_ORIGINS: baseUrl, NODE_ENV: 'development', SAMSARA_SYNC_ON_STARTUP: 'false', WORKORDER_STORAGE_DIR: artifacts });
const { getPool, closePool } = await import('../../src/server/db/pool.js');
const { seedMaintenanceFixture } = await import('./inspection-maintenance-fixture.js');
const { auth } = await import('../../src/server/auth/auth.js');
const pool = getPool();
const fixture = await seedMaintenanceFixture(pool);
await pool.query("update user_company_memberships set company_id=$2,role='admin' where user_id=$1", [fixture.otherOfficeId, fixture.companyId]);
await pool.query('insert into user_location_memberships(user_id,location_id,company_id) values($1,$2,$3)', [fixture.otherOfficeId, fixture.locationId, fixture.companyId]);
await pool.query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code)
 select gen_random_uuid(),$1,'BATCH-'||lpad(n::text,3,'0'),'BATCH-'||lpad(n::text,3,'0'),'Batch navigation fixture','ea' from generate_series(1,200) n`, [fixture.companyId]);
await pool.query(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id)
 select company_id,$2,id,normalized_part_number,part_number,description,1,0,'ea','local','batch:'||id from parts_catalog where company_id=$1`, [fixture.companyId, fixture.locationId]);
const username = `batch${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const password = `Batch-${randomUUID()}!`;
const email = `${username}@example.test`;
const account = await auth.api.signUpEmail({ body: { name:'Batch Admin', email, username, displayUsername:username, password } });
await pool.query('update user_profiles set auth_user_id=$2,contact_email=$3 where id=$1', [fixture.otherOfficeId, account.user.id, email]);
const server = spawn(process.execPath, ['server.js'], { env:process.env, stdio:['ignore','pipe','pipe'] });
let log = ''; server.stdout.on('data', x => { log += x; }); server.stderr.on('data', x => { log += x; });
let browser;
try {
  for (let i=0; i<100; i++) { if (server.exitCode != null) throw new Error(log); try { if ((await fetch(`${baseUrl}/health/live`)).ok) break; } catch {} if (i===99) throw new Error('Server not ready'); await new Promise(r => setTimeout(r,100)); }
  browser = await chromium.launch({headless:true});
  for (const width of [1440,390]) {
    const context = await browser.newContext({ viewport:{width,height:900} });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    await page.goto(baseUrl);
    await page.getByLabel('Username or email', {exact:true}).fill(username);
    await page.locator('#login-password').fill(password);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.locator('#login-password').waitFor({state:'hidden'});
    await page.goto(`${baseUrl}/?adminView=inventory&inventorySection=stock&stockMode=part`);
    const collection = page.locator('.checkpoint-collection').filter({has:page.locator('.inventory-stock-row')}).first();
    await collection.locator('[data-checkpoint-page="1"]').first().waitFor();
    const requests = [];
    let release6; const gate6 = new Promise(resolve => { release6 = resolve; });
    let entered6; const started6 = new Promise(resolve => { entered6 = resolve; });
    let fail4 = false;
    await page.route('**/api/office/inventory/stock?*', async route => {
      const url = new URL(route.request().url()); const target = Number(url.searchParams.get('page'));
      requests.push(target);
      if (target === 6) { const response = await route.fetch(); entered6(); await gate6; await route.fulfill({response}).catch(() => {}); return; }
      if (target === 4 && fail4) { fail4 = false; await route.abort('failed'); return; }
      await route.continue().catch(() => {});
    });
    async function jump(n) {
      if (width > 700) await collection.getByRole('button',{name:new RegExp(`parts: Batch ${n} of`)}).click();
      else { const beforeRequests=requests.length; await collection.getByRole('button',{name:/parts: Choose batch/}).click(); if(n===4) { const rail=await collection.locator('.checkpoint-rail').boundingBox(); assert.ok(rail && rail.y>=0 && rail.y+rail.height<=900,'mobile chooser remains on screen'); assert.equal(requests.length,beforeRequests,'opening chooser does not fetch another batch'); const dimensions=await page.evaluate(()=>({page:document.documentElement.scrollWidth, viewport:document.documentElement.clientWidth})); assert.ok(dimensions.page<=dimensions.viewport+1,'mobile page must not overflow horizontally'); } await page.getByRole('option',{name:new RegExp(`^Batch ${n} /`)}).click(); }
    }
    const selected = n => width > 700 ? collection.getByRole('button',{name:new RegExp(`parts: Batch ${n} of`)}) : collection.getByRole('button',{name:new RegExp(`parts: Choose batch, current batch ${n} of`)});
    await jump(6); await started6;
    assert.equal(await selected(6).count(),1,'pending target is immediately selected');
    if (width > 700) assert.equal(await selected(6).getAttribute('aria-current'),'page');
    await collection.getByRole('status').filter({hasText:/Loading batch 6/i}).waitFor();
    assert.ok(await collection.locator('[aria-busy="true"]').count(), 'old rows remain marked busy');
    assert.ok(await collection.locator('[data-checkpoint-page="1"]').count(), 'old rows remain visible while loading');
    await page.screenshot({path:join(artifacts,`stock-${width}-pending.png`)});
    await jump(6); assert.equal(requests.filter(n=>n===6).length,1,'repeated pending jump does not restart');
    await jump(8);
    await collection.locator('[data-checkpoint-page="8"]').first().waitFor();
    const rows8 = await collection.locator('[data-checkpoint-page="8"]').allTextContents();
    release6(); await page.waitForTimeout(500);
    assert.deepEqual(await collection.locator('[data-checkpoint-page="8"]').allTextContents(),rows8,'stale response cannot replace batch 8');
    assert.equal(await collection.locator('[data-checkpoint-page="6"]').count(),0);
    const before = requests.filter(n=>n===8).length;
    await jump(1); await collection.locator('[data-checkpoint-page="1"]').first().waitFor();
    await jump(8); await collection.locator('[data-checkpoint-page="8"]').first().waitFor();
    await page.waitForFunction(({ width }) => width > 700 ? Boolean(document.querySelector('.checkpoint-rail [aria-current="page"][aria-label^="parts: Batch 8 of"]')) : Boolean(document.querySelector('[aria-label^="parts: Choose batch, current batch 8 of"]')), {width});
    assert.equal(requests.filter(n=>n===8).length,before,'cached return does not fetch target again');
    await page.waitForFunction(() => {
      const collection = document.querySelector('.checkpoint-collection:has(.inventory-stock-row)');
      const viewport = collection?.querySelector('.checkpoint-queue-scroll');
      if (!viewport || collection.querySelector('.checkpoint-rail[aria-busy="true"]')) return false;
      const top = innerWidth <= 700 ? 0 : Math.max(0, viewport.getBoundingClientRect().top);
      const bottom = innerWidth <= 700 ? innerHeight : Math.min(innerHeight, viewport.getBoundingClientRect().bottom);
      const first = [...viewport.querySelectorAll('[data-checkpoint-page]')].find(row => row.getBoundingClientRect().bottom > top && row.getBoundingClientRect().top < bottom);
      return first?.dataset.checkpointPage === '8';
    });
    const beforeFailure = await collection.locator('.checkpoint-rail [aria-current="page"]').getAttribute('aria-label').catch(() => null);
    assert.match(beforeFailure || '', /Batch 8 of/, 'batch 8 stays selected after restoration settles');
    if (width === 390) {
      const beforeCancel = await page.evaluate(() => scrollY);
      const beforeRequests = requests.length;
      await collection.getByRole('button',{name:/parts: Choose batch/}).click();
      await page.locator('.checkpoint-rail-dropdown-popover:not([data-entering])').waitFor({state:'visible'});
      await page.getByRole('listbox').focus();
      await page.keyboard.press('Escape');
      await page.waitForFunction(y => Math.abs(scrollY-y)<5, beforeCancel);
      assert.equal(requests.length,beforeRequests,'opening and cancelling chooser does not fetch another batch');
      assert.match(await collection.locator('.checkpoint-rail [aria-current="page"]').getAttribute('aria-label'), /Batch 8 of/, 'cancelling chooser preserves batch 8');
    }
    fail4=true; await jump(4);
    await collection.getByRole('button',{name:/retry|try again/i}).waitFor();
    await page.screenshot({path:join(artifacts,`stock-${width}-failed.png`)});
    const activeAfterFailure = await collection.locator('.checkpoint-rail [aria-current="page"]').getAttribute('aria-label').catch(() => null);
    assert.equal(await selected(8).count(),1,`failed jump restores committed selection; active ${activeAfterFailure}`);
    if (width > 700) assert.equal(await selected(8).getAttribute('aria-current'),'page');
    await collection.getByRole('button',{name:/retry|try again/i}).click();
    await collection.locator('[data-checkpoint-page="4"]').first().waitFor();
    await page.screenshot({path:join(artifacts,`stock-${width}.png`)});
    console.log(`PASS ${width}: pending, latest click, cache, failure and retry`);
    await context.close();
  }
  console.log(`Artifacts: ${artifacts}`);
} catch (error) { console.error(error); console.error(`Artifacts: ${artifacts}\n${log.slice(-2000)}`); process.exitCode=1; }
finally { if (browser) await browser.close(); server.kill('SIGTERM'); await new Promise(resolve => { if (server.exitCode != null) resolve(); else { server.once('exit',resolve); setTimeout(resolve,3000); } }); if (server.exitCode == null) server.kill('SIGKILL'); await closePool(); }
