import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium, webkit } from "playwright";

const target = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || !/^\/inspection_maintenance_test_[a-f0-9]{32}$/.test(target.pathname)) throw new Error("Browser rehearsal requires runner's disposable local database.");
const port = Number(process.env.QA_MAINTENANCE_PORT || 4199);
const baseUrl = `http://localhost:${port}`;
process.env.PORT = String(port);
process.env.BETTER_AUTH_URL = baseUrl;
process.env.AUTH_TRUSTED_ORIGINS = baseUrl;
process.env.NODE_ENV = "development";
process.env.SAMSARA_SYNC_ON_STARTUP = "false";
const storage = await mkdtemp(join(tmpdir(), "inspection-maintenance-browser-"));
process.env.WORKORDER_STORAGE_DIR = storage;
const { getPool, closePool } = await import("../../src/server/db/pool.js");
const { seedMaintenanceFixture } = await import("./inspection-maintenance-fixture.js");
const { recordProviderAssetMileage } = await import("../../src/server/db/repositories/asset-mileage.repo.js");
const { auth } = await import("../../src/server/auth/auth.js");
const fixture = await seedMaintenanceFixture(getPool());
await getPool().query("update user_company_memberships set role='admin',company_id=$2 where user_id=$1",[fixture.otherOfficeId,fixture.companyId]);
const tabletTemplate = structuredClone(fixture.template);
tabletTemplate.sections[0].items.push(...Array.from({length:20},(_,index)=>({key:`tablet-item-${index}`,label:`Tablet checkpoint ${index+1}`,required:true,allowNa:false,requireNaReason:false})));
await getPool().query("update inspections set template_snapshot=$2::jsonb,template_snapshot_sha256=$3 where id=$1",[fixture.activeInspectionId,JSON.stringify(tabletTemplate),createHash('sha256').update(JSON.stringify(tabletTemplate)).digest('hex')]);
for(let n=1;n<=24;n++) {
  const assetId=randomUUID();
  await getPool().query("insert into assets(id,company_id,location_id,provider,unit_type,unit_no,name) values($1,$2,$3,'manual','Truck',$4,'iPad queue truck')",[assetId,fixture.companyId,fixture.locationId,`IPAD-${n}`]);
  await getPool().query(`insert into inspections(id,company_id,location_id,asset_id,inspection_number,inspection_kind,unit_type,status,version,template_version_id,template_snapshot,template_snapshot_sha256,asset_snapshot,requested_by_user_id,requested_at)
    select gen_random_uuid(),company_id,location_id,$2,$3,inspection_kind,unit_type,'assigned',1,template_version_id,template_snapshot,template_snapshot_sha256,asset_snapshot,requested_by_user_id,now() - $4 * interval '1 minute'
    from inspections where id=$1`,[fixture.activeInspectionId,assetId,`IPAD-${n}`,n]);
}
const password = `Maintenance-${randomUUID()}!`;
const accounts = [];
for (const [role, profileId] of [["mechanic", fixture.mechanicId], ["office", fixture.officeId], ["admin",fixture.otherOfficeId]]) {
  const username = `maint${role}${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const email = `${username}@example.test`;
  const result = await auth.api.signUpEmail({ body: { name: `Maintenance ${role}`, email, username, displayUsername: username, password } });
  await getPool().query("update user_profiles set auth_user_id=$2,contact_email=$3 where id=$1", [profileId, result.user.id, email]);
  accounts.push({ role, username });
}

const server = spawn(process.execPath, ["server.js"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", chunk => { serverLog += chunk.toString(); });
server.stderr.on("data", chunk => { serverLog += chunk.toString(); });
let browser;
async function ready() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode != null) throw new Error(`Disposable app server exited: ${serverLog.slice(-2000)}`);
    try { const response = await fetch(`${baseUrl}/health/live`); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Disposable app server did not start: ${serverLog.slice(-2000)}`);
}
async function signedIn(account, viewport) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: false, deviceScaleFactor: 2, userAgent: "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1" });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.getByLabel("Username or email", { exact: true }).fill(account.username);
  await page.locator("#login-password").fill(password);
  const signInResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/sign-in/username");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  assert.equal((await signInResponse).status(), 200);
  await page.locator("#login-password").waitFor({ state: "hidden" });
  await page.goto(`${baseUrl}/?${account.role === "admin" ? "adminView=operations&" : ""}from=inspection&inspection=${fixture.activeInspectionId}&anchor=summary`);
  await page.getByRole("region", { name: "Maintenance to review", exact: true }).waitFor();
  return { context, page };
}
async function assertNoOverflow(page) {
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  assert.ok(widths.page <= widths.viewport + 1, `Horizontal overflow ${JSON.stringify(widths)}`);
  const internal=await page.evaluate(()=>[...document.querySelectorAll('.inspection-detail,.inspection-experience,.inspection-create,.admin-operations-content > .operational-collection-page-body')].map(el=>({class:el.className,client:el.clientWidth,scroll:el.scrollWidth})).filter(item=>item.scroll>item.client+1));
  assert.deepEqual(internal,[],`Internal horizontal overflow: ${JSON.stringify(internal)}`);
}

const viewports = [{width:820,height:1180},{width:1180,height:820},{width:768,height:1024},{width:1024,height:768},{width:390,height:844},{width:1440,height:1000}];
async function scrollPosition(page) {
  return page.evaluate(() => scrollY + [...document.querySelectorAll('*')].reduce((sum,el) => sum + el.scrollTop,0));
}
async function resetScroll(page) {
  await page.evaluate(() => { window.scrollTo(0,0); for(const el of document.querySelectorAll('*')) if(el.scrollTop) el.scrollTop=0; });
}
async function wheelDown(page, viewport, amount=900) {
  await page.mouse.move(viewport.width-60,viewport.height*0.6);
  await page.mouse.wheel(0,amount);
  await page.waitForTimeout(180);
}
async function swipeDown(page,viewport) {
  const session=await page.context().newCDPSession(page);
  const x=viewport.width-65;
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:viewport.height*0.8}]});
  for(let step=1;step<=12;step++) {
    await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:viewport.height*(0.8-step*0.045)}]});
    await page.waitForTimeout(18);
  }
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForTimeout(250);
  await session.detach();
}
async function assertReachEnd(page, selector, viewport) {
  // Wheel/swipe input must expose the bottom; scrollIntoView would hide the bug.
  for(let step=0;step<15;step++) {
    const bottom=await page.locator(selector).evaluate(el=>el.getBoundingClientRect().bottom);
    if(bottom<=viewport.height-8) break;
    await wheelDown(page,viewport);
  }
  const geometry=await page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom};});
  assert.ok(geometry.bottom<=viewport.height+1,`Last inspection content unreachable: ${JSON.stringify(geometry)}`);
  await assertNoOverflow(page);
}
try {
  await ready();
  const results=[];
  for(const [engine,browserType] of [['chromium',chromium],['webkit',webkit]]) {
    browser=await browserType.launch({headless:true});
    for(const account of accounts) {
      const {page,context}=await signedIn(account,viewports[0]);
      page.setDefaultTimeout(12000);
      if(account.role==='mechanic' && await page.getByRole('button',{name:'Start inspection',exact:true}).count()) {
        await page.getByLabel('Odometer miles',{exact:true}).fill('9800');
        await page.getByText('Previous report reviewed',{exact:true}).click();
        await page.getByRole('button',{name:'Start inspection',exact:true}).click();
        await page.locator('.inspection-completion').waitFor();
      }
      const section=page.locator('.inspection-section-trigger').first();
      if(await section.count() && await section.getAttribute('aria-expanded')==='false') await section.click();
      for(const viewport of viewports) {
        await page.setViewportSize(viewport);
        await resetScroll(page);
        const needsScroll=await page.locator('.inspection-detail').evaluate((el,height)=>el.getBoundingClientRect().bottom>height,viewport.height);
        await wheelDown(page,viewport);
        if(account.role!=='office'||needsScroll) assert.ok(await scrollPosition(page)>20,`${engine}/${account.role}/${viewport.width}: wheel did not scroll long inspection`);
        if((account.role!=='office'||needsScroll) && engine==='chromium' && viewport.width>=768 && viewport.width<=1180) {
          await resetScroll(page);
          await swipeDown(page,viewport);
          assert.ok(await scrollPosition(page)>20,`${account.role}/${viewport.width}: touch swipe did not scroll`);
        }
        await assertReachEnd(page,'.inspection-detail',viewport);
        await page.screenshot({path:join(storage,`${engine}-${account.role}-${viewport.width}-bottom.png`)});
        // Real interaction at the end must stay operable after scrolling.
        if(account.role==='mechanic') {
          const notes=page.locator('.inspection-optional-notes summary');
          await notes.click();
          await page.locator('.inspection-completion textarea').fill(`iPad scroll ${engine} ${viewport.width}`);
          await notes.click();
        }
        console.log(`PASS ${engine}/${account.role}/${viewport.width}`);
        results.push({engine,role:account.role,viewport,scroll:needsScroll?'PASS':'content fits',noHorizontalOverflow:true});
      }
      if(account.role==='admin') {
        for(const viewport of viewports) {
          await page.setViewportSize(viewport);
          await resetScroll(page);
          const reloaded=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/inspections' && response.request().method()==='GET');
          await page.getByRole('button',{name:/Back to inspections:/}).click();
          await reloaded;
          await page.locator('.inspection-experience').waitFor();
          await page.locator('.inspection-row').first().waitFor();
          await page.locator('.inspection-table[aria-busy="false"]').waitFor();
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          await resetScroll(page);
          for(let attempt=0;attempt<3 && await scrollPosition(page)<=20;attempt++) await wheelDown(page,viewport);
          assert.ok(await scrollPosition(page)>20,`${engine}/${viewport.width}: inspection list did not scroll`);
          await assertReachEnd(page,'.inspection-experience',viewport);
          await page.goto(`${baseUrl}/?adminView=operations&from=inspection&inspection=${fixture.activeInspectionId}&anchor=summary`);
          await page.locator('.inspection-detail').waitFor();
        }
        for(const viewport of viewports.slice(0,2)) {
          await page.setViewportSize(viewport);
          await resetScroll(page);
          await page.getByRole('button',{name:'Create',exact:true}).click();
          await page.getByRole('menuitem',{name:'Create inspection',exact:true}).click();
          await page.getByRole('heading',{name:'New inspection',exact:true}).waitFor();
          await page.getByLabel('Search truck or trailer',{exact:true}).fill('IPAD');
          await page.locator('.inspection-unit-results li').nth(19).waitFor();
          await resetScroll(page);
          await wheelDown(page,viewport);
          assert.ok(await scrollPosition(page)>20,`${engine}: long create form did not scroll`);
          if(engine==='chromium') {
            await resetScroll(page);await swipeDown(page,viewport);
            assert.ok(await scrollPosition(page)>20,'Create form touch swipe did not scroll');
          }
          await assertReachEnd(page,'.inspection-create',viewport);
          await page.screenshot({path:join(storage,`${engine}-create-${viewport.width}-bottom.png`)});
          await page.getByRole('button',{name:'Cancel',exact:true}).click();
          await page.locator('.inspection-detail').waitFor();
        }
      }
      await context.close();
    }
    await browser.close();browser=null;
  }
  console.log(JSON.stringify({result:'PASS',checks:results,extra:['Admin list scroll and return at all six sizes','Admin create form','Chromium real touch gestures at four iPad sizes','WebKit wheel scrolling','Mechanic bottom controls operable'],artifacts:storage}));
} catch(error) {
  console.error(error);
  if(browser) for(const context of browser.contexts()) for(const page of context.pages()) {
    console.error((await page.locator('body').innerText()).slice(0,3000));
    await page.screenshot({path:join(storage,'failure.png')});
  }
  console.error(`Artifacts: ${storage}`);
  process.exitCode=1;
} finally {
  if(browser) await browser.close();
  server.kill('SIGTERM');
  await new Promise(resolve=>{if(server.exitCode!=null)resolve();else{server.once('exit',resolve);setTimeout(resolve,3000);}});
  if(server.exitCode==null)server.kill('SIGKILL');
  await closePool();
}
