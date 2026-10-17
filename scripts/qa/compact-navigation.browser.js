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
const storage = await mkdtemp(join(tmpdir(), "compact-navigation-browser-"));
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
const surveillanceId = randomUUID();
await getPool().query("insert into user_profiles(id,display_name) values($1,'Navigation surveillance')", [surveillanceId]);
await getPool().query("insert into user_company_memberships(user_id,company_id,role) values($1,$2,'surveillance')", [surveillanceId,fixture.companyId]);
await getPool().query("insert into user_location_memberships(user_id,location_id,company_id) values($1,$2,$3)", [surveillanceId,fixture.locationId,fixture.companyId]);
const accounts = [];
for (const [role, profileId] of [["mechanic", fixture.mechanicId], ["office", fixture.officeId], ["admin",fixture.otherOfficeId], ["surveillance",surveillanceId]]) {
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
// Exercise the real authenticated role shells; all data lives in the runner's disposable database.
const widths = [390, 700, 701, 768, 820, 1024, 1180, 1199, 1200, 1440];
const results = [];
const screenshots = [];
async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function geometry(page) {
  return page.evaluate(() => {
    const rail = document.querySelector('.role-navigation-rail');
    const content = rail?.nextElementSibling;
    const box = element => { const r = element.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
    return { width:innerWidth, height:innerHeight, pageWidth:document.documentElement.scrollWidth,
      rail:rail ? box(rail) : null, content:content ? box(content) : null,
      compact:rail?.dataset.compact, overlay:rail?.dataset.overlay };
  });
}
try {
  await ready();
  for (const [engine, browserType] of [['chromium',chromium],['webkit',webkit]].filter(([name])=>!process.env.QA_NAV_ENGINE || process.env.QA_NAV_ENGINE===name)) {
    browser = await browserType.launch({headless:true});
    for (const account of accounts.filter(account=>!process.env.QA_NAV_ROLE || process.env.QA_NAV_ROLE===account.role)) {
      const context = await browser.newContext({viewport:{width:1440,height:900},hasTouch:true,deviceScaleFactor:2});
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      await page.goto(baseUrl);
      await page.getByLabel('Username or email',{exact:true}).fill(account.username);
      await page.locator('#login-password').fill(password);
      const signedIn = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/sign-in/username');
      await page.getByRole('button',{name:'Sign in',exact:true}).click();
      assert.equal((await signedIn).status(),200);
      await page.locator('#login-password').waitFor({state:'hidden'});
      await page.goto(`${baseUrl}/?${account.role==='admin'?'adminView=operations':''}`);
      const rail = page.locator('.role-navigation-rail');
      await rail.waitFor();
      for (const width of widths) {
        await page.setViewportSize({width,height:width<1200?600:900});
        await settle(page);
        if (width<=700) {
          assert.equal(await rail.isVisible(),false,`${engine}/${account.role}/${width}: phone rail must hide`);
          const mobile = account.role==='admin' ? '.admin-mobile-nav' : account.role==='office' ? '.office-mobile-nav' : account.role==='mechanic' ? '.role-phone-product-switch, .mechanic-phone-queues' : '.role-phone-product-switch, .surveillance-compact-queues';
          // Role-specific phone controls must remain available; never replace them with an offscreen rail.
          assert.ok((await page.locator(mobile).all()).length && await page.locator(mobile).evaluateAll(elements=>elements.some(el=>el.getClientRects().length)),`${account.role}: phone controls absent`);
        } else {
          await rail.waitFor({state:'visible'});
          const before=await geometry(page);
          assert.ok(before.rail.y>=-1 && before.rail.bottom<=before.height+1,`${engine}/${account.role}/${width}: rail outside viewport ${JSON.stringify(before)}`);
          assert.ok(before.pageWidth<=width+1,`${engine}/${account.role}/${width}: page overflow`);
          if(width<1200) {
            assert.equal(before.compact,'true');
            assert.ok(before.rail.width>=64 && before.rail.width<=72,`${account.role}: compact width ${before.rail.width}`);
          } else assert.ok(before.rail.width>=190,`${account.role}: desktop should default expanded`);
          const targets=await rail.locator('nav button').evaluateAll(elements=>elements.filter(el=>el.getClientRects().length).map(el=>({name:el.getAttribute('aria-label')||el.textContent.trim(),height:el.getBoundingClientRect().height})));
          assert.ok(targets.length>0);
          assert.ok(targets.every(target=>target.name && target.height>=43.5),`Unreadable or small touch targets: ${JSON.stringify(targets)}`);
          assert.ok(await rail.locator('[aria-current="page"]').count(),`${account.role}: active destination missing`);
          if(width<1200) {
            await rail.getByRole('button',{name:'Expand navigation',exact:true}).click();
            await settle(page);
            const expanded=await geometry(page);
            assert.equal(expanded.overlay,'true');
            assert.ok(expanded.rail.width>=190);
            const background=await rail.evaluate(el=>getComputedStyle(el).backgroundColor);
            assert.ok(background!=='transparent' && !/rgba\([^)]*,\s*0\)$/.test(background),`${account.role}: expanded overlay must have opaque background (${background})`);
            if(account.role==='admin' && width===1024) {
              const file=join(storage,`${engine}-admin-1024-expanded.png`);await page.screenshot({path:file});screenshots.push(file);
            }
            assert.ok(Math.abs(expanded.content.x-before.content.x)<1,`${account.role}: expansion shifts form`);
            assert.ok(Math.abs(expanded.content.width-before.content.width)<1,`${account.role}: expansion resizes form`);
            await page.keyboard.press('Escape');
            await settle(page);
            assert.equal((await geometry(page)).compact,'true');
            await rail.getByRole('button',{name:'Expand navigation',exact:true}).click();
            await page.mouse.click(width-10,300);
            await settle(page);
            assert.equal((await geometry(page)).compact,'true',`${account.role}: outside click fails to close`);
            if(width===820) {
              await rail.getByRole('button',{name:'Expand navigation',exact:true}).click();
              await rail.getByRole('button',{name:'Workorders',exact:true}).click();
              await settle(page);
              assert.equal((await geometry(page)).compact,'true',`${account.role}: navigation fails to close overlay`);
            }
          }
          const list=rail.locator('.role-navigation-list');
          const metrics=await list.evaluate(el=>({client:el.clientHeight,scroll:el.scrollHeight}));
          if(metrics.scroll>metrics.client+1) {
            const box=await list.boundingBox();
            await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
            await page.mouse.wheel(0,1200);
            await page.waitForTimeout(100);
            assert.ok(await list.evaluate(el=>el.scrollTop)>0,'Long navigation cannot scroll');
            await list.locator('button').last().scrollIntoViewIfNeeded();
            const last=await list.locator('button').last().boundingBox();
            assert.ok(last.y>=0 && last.y+last.height<=page.viewportSize().height+1,`Last destination clipped: ${JSON.stringify({width,viewport:page.viewportSize(),last})}`);
          }
          if(account.role==='admin' && [1024,1440].includes(width)) {
            const file=join(storage,`${engine}-admin-${width}.png`);await page.screenshot({path:file});screenshots.push(file);
          }
        }
        results.push({engine,role:account.role,width,status:'PASS'});
        console.log(`PASS ${engine}/${account.role}/${width}`);
      }
      // Desktop preference, rotation boundary, keyboard activation and account popover.
      await page.evaluate(()=>{
        window.__navigationDiagnostics=[];
        const record=(event)=>{window.__navigationDiagnostics.push({type:event.type,time:performance.now(),target:event.target.className||event.target.nodeName,scrollTop:event.target.scrollTop,active:document.activeElement?.getAttribute('aria-label'),listTop:document.querySelector('.role-navigation-list')?.scrollTop,tooltips:document.querySelectorAll('[role=tooltip]').length});window.__navigationDiagnostics=window.__navigationDiagnostics.slice(-30);};
        document.addEventListener('scroll',record,true);document.addEventListener('focusin',record,true);
      });
      await rail.getByRole('button',{name:'Collapse navigation',exact:true}).click();
      assert.equal((await geometry(page)).compact,'true');
      await rail.getByRole('button',{name:'Expand navigation',exact:true}).focus();
      await page.keyboard.press('Tab');
      assert.ok(await rail.getByRole('button',{name:'Workorders',exact:true}).evaluate(el=>el===document.activeElement),'Tab must reach first compact destination');
      await page.getByRole('tooltip',{name:'Workorders',exact:true}).waitFor();
      await page.keyboard.press('Escape');
      await rail.getByRole('button',{name:'Expand navigation',exact:true}).press('Enter');
      assert.equal((await geometry(page)).compact,'false');
      await page.setViewportSize({width:820,height:600});await settle(page);
      await rail.getByRole('button',{name:'Expand navigation',exact:true}).click();
      await rail.getByRole('button',{name:'Open account menu',exact:true}).click();
      await page.getByRole('dialog',{name:'Profile actions',exact:true}).waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog',{name:'Profile actions',exact:true}).waitFor({state:'hidden'});
      assert.equal((await geometry(page)).overlay,'true','First Escape must dismiss account menu without closing navigation');
      await page.keyboard.press('Escape');await settle(page);
      assert.equal((await geometry(page)).compact,'true','Second Escape must close navigation');
      if(account.role==='admin') {
        await page.getByRole('button',{name:'Create',exact:true}).click();
        await page.getByRole('menuitem',{name:'Create inspection',exact:true}).click();
        const input=page.getByLabel('Search truck or trailer',{exact:true});await input.fill('QA-MAINT');
        const before=await input.boundingBox();
        await rail.getByRole('button',{name:'Expand navigation',exact:true}).click();
        await page.keyboard.press('Escape');
        assert.equal(await input.inputValue(),'QA-MAINT','Rail toggle lost form input');
        const after=await input.boundingBox();assert.ok(Math.abs(before.x-after.x)<1 && Math.abs(before.width-after.width)<1);
        await page.setViewportSize({width:1024,height:500});await settle(page);
        await page.getByRole('button',{name:'Request inspection',exact:true}).scrollIntoViewIfNeeded();
        const footer=await page.getByRole('button',{name:'Request inspection',exact:true}).boundingBox();
        assert.ok(footer.y>=0 && footer.y+footer.height<=501,'Inspection action unreachable');
        // 200% browser-equivalent reflow uses half the CSS viewport, not a CSS scale transform.
        await page.setViewportSize({width:512,height:384});await settle(page);
        assert.equal(await rail.isVisible(),false);
        assert.equal(await input.inputValue(),'QA-MAINT');
        await page.getByRole('button',{name:'Cancel',exact:true}).click();
      }
      await context.close();
    }
    await browser.close();browser=null;
  }
  console.log(JSON.stringify({result:'PASS',cases:results.length,checks:results,screenshots,artifacts:storage}));
} catch(error) {
  console.error(error);
  if(browser)for(const context of browser.contexts())for(const page of context.pages()) {
    console.error((await page.locator('body').innerText()).slice(0,2500));
    console.error(JSON.stringify(await page.evaluate(()=>({width:innerWidth,height:innerHeight,active:document.activeElement?.outerHTML,rail:document.querySelector('.role-navigation-rail')?.dataset,tooltips:[...document.querySelectorAll('[role=tooltip]')].map(el=>({html:el.outerHTML,rect:el.getBoundingClientRect().toJSON(),visibility:getComputedStyle(el).visibility,display:getComputedStyle(el).display})),events:window.__navigationDiagnostics,listScrollTop:document.querySelector('.role-navigation-list')?.scrollTop,list:document.querySelector('.role-navigation-list')?.getBoundingClientRect().toJSON()}))));
    await page.screenshot({path:join(storage,'failure.png')});
  }
  console.error(`Artifacts: ${storage}`);process.exitCode=1;
} finally {
  if(browser)await browser.close();server.kill('SIGTERM');
  await new Promise(resolve=>{if(server.exitCode!=null)resolve();else{server.once('exit',resolve);setTimeout(resolve,3000);}});
  if(server.exitCode==null)server.kill('SIGKILL');await closePool();
}
