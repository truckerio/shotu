// Render the complete Stock detail panel; stub data only, keep real UI/editors/styles.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repo = resolve(import.meta.dirname, '../..');
const name = '.price-presentation-qa';
const html = join(repo, 'frontend', `${name}.html`);
const jsx = join(repo, 'frontend', `${name}.jsx`);
const port = Number(process.env.QA_PRICE_PRESENTATION_PORT || 5193);
const base = `http://127.0.0.1:${port}`;
const artifacts = await mkdtemp(join(tmpdir(), 'inventory-price-presentation-'));
let server, browser;
let serverLog = '';
const errors = [];
try {
  await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.jsx"></script></body></html>`);
  await writeFile(jsx, `import React from 'react'; import {createRoot} from 'react-dom/client'; import './src/typography.css'; import './src/styles.css'; import {InventoryWorkspace} from './src/features/inventory/InventoryWorkspace.jsx'; createRoot(document.getElementById('root')).render(<InventoryWorkspace actorId="price-qa" />);`);
  server = spawn(process.execPath, [join(repo, 'node_modules/vite/bin/vite.js'), '--config', 'frontend/vite.config.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {cwd:repo, stdio:['ignore','pipe','pipe']});
  server.stdout.on('data', chunk => { serverLog += chunk; });
  server.stderr.on('data', chunk => { serverLog += chunk; });
  for (let n=0;n<100;n++) {
    if (server.exitCode !== null) throw new Error(serverLog);
    try { if ((await fetch(`${base}/${name}.html`)).ok) break; } catch {}
    if (n===99) throw new Error(`Vite not ready: ${serverLog}`);
    await new Promise(r => setTimeout(r,100));
  }
  browser = await chromium.launch({headless:true});
  for (const width of [1440,390]) {
    const context = await browser.newContext({viewport:{width,height:1000}, reducedMotion:'reduce'});
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    let known = false, readOnly = false, otherIssue = false, noStock = false;
    const writes = [];
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (request.method() !== 'GET') writes.push(path);
      const location = {id:'shop',locationId:'shop',name:'Chino shop',locationName:'Chino shop',companyId:'company',company_id:'company',canManage:!readOnly,canManageCompany:!readOnly,quantityOnHand:287,quantityAvailable:287,quantityReserved:0,issues:['missing_internal_price','missing_selling_price']};
      const part = {catalogPartId:'part',companyId:'company',partNumber:'180.10641.1',description:'Hubcap gasket',uomCode:'ea',trackingMode:noStock?'no_stock':'quantity',quantityOnHand:287,quantityAvailable:287,quantityReserved:0,locations:[location],issues:[...location.issues,...(otherIssue?['review_tracking']:[])]};
      const price = known ? {amount:'0',currency:'USD',status:'known',version:1} : null;
      const projection = {current:price,effective:price,source:'company_default',history:[],override:{current:null,history:[]},companyDefault:{current:price,history:[]}};
      let json = {};
      if (path.endsWith('/template')) json = {locations:readOnly?[]:[{location}]};
      else if (path.endsWith('/browse-locations')) json = {locations:[location]};
      else if (path.endsWith('/stock')) json = {items:[part],total:1,pageCount:1,counts:{all:1,available:1,reserved:0,out:0}};
      else if (path.endsWith('/commercial')) json = {part,prices:{internal:projection,selling:projection},receiptCosts:{observations:[]},purchaseOrders:{observations:[]},capabilities:{canEditPrices:!readOnly}};
      else if (path.endsWith('/selling-policy')) json = {policy:known?{method:'markup_percent',value:'25',currency:'USD'}:null,capabilities:{canEdit:!readOnly,canEditBatchCost:!readOnly},availableBatches:[{costLayerId:'batch',locationId:'shop',locationName:'Chino shop',sourceKind:'legacy',availableQuantity:287,reservedQuantity:0,uomCode:'ea',unitCost:known?'0':null,currency:'USD',receivedAt:'2026-09-22',placements:[{positionId:'shelf',code:'A2-B1-S3',name:'Shelf 3'}]}]};
      await route.fulfill({json});
    });
    async function openPart() {
      await page.goto(`${base}/${name}.html`);
      await page.getByRole('row',{name:/Open details for 180\.10641\.1/}).click();
      const panel = page.getByRole('dialog');
      await panel.getByRole('region',{name:'Configured rates',exact:true}).waitFor();
      return panel;
    }
    let panel = await openPart();
    const mismatches=[];
    const check=fn=>{try {fn();} catch(error) {mismatches.push(error.message);}};
    const banners=await panel.locator('.inventory-part-issue-summary').count();
    check(()=>assert.equal(banners,0,'price warnings must not repeat in top banner'));
    const rates = panel.getByRole('region',{name:'Configured rates',exact:true});
    assert.equal(await rates.getByText('Missing internal price',{exact:true}).count(),1);
    assert.equal(await rates.getByText('Missing selling price',{exact:true}).count(),1);
    const values=await rates.locator('strong').allTextContents();
    check(()=>assert.deepEqual(values,['NA','NA'],'missing rates display only NA'));
    const cost=await panel.locator('.inventory-batch-row footer strong').innerText();
    check(()=>assert.equal(cost,'NA','missing batch cost displays only NA'));
    const header=await panel.locator('.inventory-part-header-price').innerText();
    check(()=>assert.equal(header,'Selling · NA'));
    for (const label of ['Add cost','Set rates']) {
      const button = panel.getByRole('button',{name:label,exact:true});
      const style = await button.evaluate(node => { const s=getComputedStyle(node), text=getComputedStyle(node.querySelector('span')), box=node.getBoundingClientRect(); return {background:s.backgroundColor,color:text.color,weight:Number(text.fontWeight),height:box.height}; });
      check(()=>assert.equal(style.background,'rgb(21, 112, 239)',`${label} has emphasized blue fill`));
      check(()=>assert.equal(style.color,'rgb(255, 255, 255)',`${label} label stays white despite pricing typography`));
      check(()=>assert.ok(style.weight>=600,`${label} label has emphasis`));
      assert.ok(style.height>=44,`${label} remains touch sized`);
    }
    assert.deepEqual(mismatches,[],'Price presentation regressions');
    await panel.getByRole('button',{name:'Add cost',exact:true}).click();
    await panel.getByLabel('Unit cost',{exact:true}).waitFor();
    assert.equal(await panel.getByRole('button',{name:'Save cost',exact:true}).isDisabled(),true);
    await panel.getByRole('button',{name:'Cancel',exact:true}).click();
    await panel.getByRole('button',{name:'Set rates',exact:true}).click();
    const dialog = page.getByRole('dialog',{name:'Set rates',exact:true});
    await dialog.waitFor();
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.screenshot({path:join(artifacts,`missing-${width}.png`)});
    const geometry = await panel.evaluate(node => ({left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right,width:innerWidth,scroll:node.scrollWidth,client:node.clientWidth}));
    assert.ok(geometry.left>=-1&&geometry.right<=width+1&&geometry.scroll<=geometry.client+1,`panel fits ${width}: ${JSON.stringify(geometry)}`);
    known = true;
    panel = await openPart();
    assert.match(await panel.locator('.inventory-configured-rates').innerText(),/\$0\.00 \/ ea/,'explicit zero stays a real price');
    assert.match(await panel.locator('.inventory-configured-rates').innerText(),/25% markup \/ ea/);
    assert.match(await panel.locator('.inventory-batch-row footer strong').innerText(),/\$0\.00 \/ ea/);
    noStock = true; known = false;
    panel = await openPart();
    assert.deepEqual(await panel.locator('.inventory-configured-rates strong').allTextContents(),['NA','NA']);
    const noStockAction = panel.getByRole('button',{name:'Set rates',exact:true});
    assert.equal(await noStockAction.evaluate(node=>getComputedStyle(node.querySelector('span')).color),'rgb(255, 255, 255)');
    assert.ok(await noStockAction.evaluate(node=>Number(getComputedStyle(node).fontWeight))>=600);
    readOnly = true; noStock = false; otherIssue = true;
    panel = await openPart();
    assert.equal(await panel.getByRole('button',{name:'Set rates',exact:true}).count(),0);
    assert.equal(await panel.getByRole('button',{name:'Add cost',exact:true}).count(),0);
    assert.equal(await panel.locator('.inventory-part-issue-summary').innerText(),'Part needs attention','retain non-price issue notice');
    assert.deepEqual(writes,[],'opening/cancelling editors must not write prices');
    console.log(`PASS ${width}: single missing-price location, NA, button emphasis/editors, zero/markup, read-only, no overflow`);
    await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log(`Artifacts: ${artifacts}`);
} finally {
  await browser?.close();
  if (server && server.exitCode===null) { server.kill('SIGTERM'); await new Promise(r=>server.once('exit',r)); }
  await Promise.allSettled([unlink(html),unlink(jsx)]);
}
