// Actual receiving through the merged local app. Fixtures are restricted to its disposable database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { RoleApiClient } from './e2e/api-client.js';
const baseUrl = new URL(process.env.QA_BASE_URL || 'http://localhost:4173');
const database = new URL(process.env.DATABASE_URL);
assert.ok(['localhost','127.0.0.1'].includes(baseUrl.hostname));
assert.ok(['localhost','127.0.0.1'].includes(database.hostname) && database.pathname.startsWith('/inventory_developer_'));
const output = process.env.QA_OUTPUT; assert.ok(output); await mkdir(output,{recursive:true});
const client = await RoleApiClient.create({role:'admin',baseUrl,timeoutMs:20000});
let browser;
try {
 await client.authenticate({username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD});
 const template=(await client.request('/api/office/template')).body;
 const location=template.locations[0].location;
 const post=async(path,body)=>(await client.request(path,{method:'POST',body,expectedStatuses:[200,201]})).body;
 const purchase=body=>post('/api/office/inventory/purchasing',{locationId:location.id,idempotencyKey:randomUUID(),...body});
 const request=body=>post('/api/office/inventory/purchase-requests',{locationId:location.id,idempotencyKey:randomUUID(),...body});
 browser=await chromium.launch();
 for(const width of [1440,390]) {
  const context=await browser.newContext({storageState:await client.storageState(),viewport:{width,height:1000}});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const flow of ['po','request']) {
   const suffix=randomUUID().slice(0,8),partNumber=`STABLE-${suffix}`;
   const part=(await post('/api/office/inventory/parts',{locationId:location.id,partNumber,description:partNumber,uomCode:'ea',trackingMode:'serialized'})).part;
   const partId=part.id||part.catalogPartId;
   let order;
   if(flow==='po') {
    const {supplier}=await purchase({action:'supplier',name:`Stability ${suffix}`});
    order=(await purchase({action:'create',supplierId:supplier.id,currency:'USD',expectedDeliveryDate:'2026-12-20',lines:[{catalogPartId:partId,quantity:1,unitPrice:'12.50'}]})).order;
    order=(await purchase({action:'submit',orderId:order.id,expectedVersion:order.version})).order;
    if(order.status==='awaiting_approval')order=(await purchase({action:'approve',orderId:order.id,expectedVersion:order.version})).order;
    order=(await purchase({action:'receive',orderId:order.id,expectedVersion:order.version,confirmation:'all_ordered_goods_received',deliveryCondition:'undamaged'})).order;
   } else {
    const created=await request({action:'request_create',catalogPartId:partId,partNumber,description:partNumber,uomCode:'ea',quantity:1});
    await request({action:'request_approve',requestId:created.request.id,expectedVersion:created.request.version});
   }
   await page.goto(`${baseUrl.origin}/?view=inventory&adminView=inventory`);
   await page.getByRole('group',{name:'Inventory sections',exact:true}).getByRole('button',{name:'Purchases',exact:true}).click();
   if(flow==='po') {
    await page.getByRole('button',{name:'Purchase orders',exact:true}).click();
    await page.getByRole('button',{name:order.number,exact:true}).click();
    await page.locator('.purchase-order-detail').getByRole('button',{name:'Add to inventory',exact:true}).click();
   } else {
    await page.getByRole('button',{name:'Approved',exact:true}).click();
    await page.getByRole('row').filter({hasText:partNumber}).getByRole('button',{name:'Mark Added',exact:true}).click();
    const chooser=page.getByRole('dialog',{name:'Add purchased stock',exact:true});
    await chooser.getByRole('combobox').fill(partNumber);
    await page.getByRole('option').filter({hasText:partNumber}).first().click();
   }
   const dialog=page.getByRole('dialog',{name:flow==='po'?'Add to inventory':'Add stock',exact:true});
   await dialog.getByRole('textbox',{name:/Scan or enter each unit identity/}).fill(`UNIT-${suffix}`);
   await dialog.getByRole('checkbox').check();
   let posts=0;const observe=r=>{if(r.url().endsWith('/api/office/inventory/direct-receipts')&&r.method()==='POST')posts++;};page.on('request',observe);
   const response=page.waitForResponse(r=>r.url().endsWith('/api/office/inventory/direct-receipts')&&r.request().method()==='POST');
   await dialog.getByRole('button',{name:flow==='po'?'Add to inventory':'Receive stock',exact:true}).click();
   const saved=await response;assert.ok([200,201].includes(saved.status()),await saved.text());
   const receipt=(await saved.json()).receipt;
   const done=page.getByRole('dialog',{name:'Stock received',exact:true});
   await done.waitFor({timeout:5000});
   await done.getByRole('link',{name:'Print unit labels',exact:true}).waitFor();
   assert.equal(await done.getByRole('link',{name:'Print unit labels',exact:true}).getAttribute('href'),receipt.labelBatch.printUrl);
   // A parent refresh must not discard the completed receipt or offer another write.
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
   await done.getByRole('button',{name:'Done',exact:true}).waitFor();
   assert.equal(posts,1);assert.equal(await done.getByRole('button',{name:'Receive stock',exact:true}).count(),0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:`${output}/${flow}-receipt-${width}.png`});
   await done.getByRole('button',{name:'Done',exact:true}).click();await done.waitFor({state:'hidden'});page.off('request',observe);
   console.log(`PASS ${flow} receipt confirmation, labels and single write at ${width}px`);
   if(flow==='po') {
    await page.goto(`${baseUrl.origin}/?view=inventory&adminView=inventory`);
    await page.getByRole('textbox',{name:'Search inventory'}).fill(partNumber);
    await page.locator('.inventory-stock-row').filter({hasText:partNumber}).click();
    await page.locator('.inventory-detail-location-row > button').filter({hasText:location.name}).click();
    await page.getByRole('button',{name:'Add stock',exact:true}).click();
    let intake=page.getByRole('dialog',{name:'Add stock',exact:true});
    await intake.getByRole('textbox',{name:/Scan or enter each unit identity/}).fill('DRAFT-AT-OTHER-SHOP');
    await intake.getByRole('button',{name:'Close',exact:true}).click();
    await page.evaluate(({partId,otherShop})=>{
     const key=Object.keys(localStorage).find(k=>k.startsWith('inventory-direct-receipt:')&&k.endsWith(':'+partId));
     if(!key)throw Error('Receipt draft was not persisted');
     const draft=JSON.parse(localStorage.getItem(key));draft.locationId=otherShop;draft.confirmed=true;localStorage.setItem(key,JSON.stringify(draft));
    },{partId,otherShop:randomUUID()});
    await page.getByRole('button',{name:'Add stock',exact:true}).click();
    intake=page.getByRole('dialog',{name:'Add stock',exact:true});
    assert.equal(await intake.getByRole('textbox',{name:/Scan or enter each unit identity/}).inputValue(),'');
    assert.equal(await intake.getByRole('checkbox').isChecked(),false);
    assert.ok((await intake.locator('.dropdown-select-trigger').first().innerText()).includes(location.name));
    await intake.getByRole('button',{name:'Close',exact:true}).click();
    console.log(`PASS explicit shop overrides unsubmitted draft at ${width}px`);
   }
  }
  assert.deepEqual(errors,[]);await context.close();
 }
} finally {await browser?.close();await client.dispose();}
