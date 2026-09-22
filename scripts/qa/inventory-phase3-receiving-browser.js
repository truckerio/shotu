import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { purchaseReceiptSchema } from "../../src/server/modules/inventory/inventory-purchasing.schemas.js";

const fixtureName=`inventory-phase3-${randomUUID()}.html`;
const fixtureUrl=new URL(`../../frontend/${fixtureName}`,import.meta.url);
const locationId=randomUUID(),actorId=randomUUID(),orderId=randomUUID(),quantityLineId=randomUUID(),serialLineId=randomUUID();
await mkdir(new URL("../../.tmp/local-server/",import.meta.url),{recursive:true});
await writeFile(fixtureUrl,`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import '/src/typography.css';import '/src/styles.css';import {InventoryPurchases} from '/src/features/inventory/InventoryPurchases.jsx';createRoot(document.getElementById('root')).render(React.createElement(InventoryPurchases,{locations:[{id:'${locationId}',name:'Main shop'}],actorId:'${actorId}'}));</script></body></html>`);
const browser=await chromium.launch({headless:true});
try{
  for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:1000}});
    const order={id:orderId,number:"PO-PHASE3",supplier_name:"Parts supplier",supplier_id:randomUUID(),status:"ordered",version:3,currency:"USD",total:"75.00",expected_delivery_date:"2026-09-20",notes:"",lines:[
      {id:quantityLineId,catalog_part_id:randomUUID(),part_number:"FILTER",description:"Oil filter",quantity:4,received_quantity:0,cancelled_quantity:0,uom_code:"ea",tracking_mode:"quantity",part_version:1,unit_price:"5.0000"},
      {id:serialLineId,catalog_part_id:randomUUID(),part_number:"ECM",description:"Control module",quantity:2,received_quantity:0,cancelled_quantity:0,uom_code:"ea",tracking_mode:"serialized",part_version:1,unit_price:"27.5000"},
    ]};
    let posted=null;
    await context.route("**/api/office/inventory/purchase-requests?*",route=>route.fulfill({json:{items:[],page:1,hasMore:false}}));
    await context.route("**/api/office/inventory/purchasing/*/bills",route=>route.fulfill({json:{items:[]}}));
    await context.route("**/api/office/inventory/purchasing?*",route=>route.fulfill({json:{items:[order],suppliers:[],receipts:[],canApprove:false,page:1,hasMore:false}}));
    await context.route(`**/api/office/inventory/purchasing/${orderId}/receipts`,async route=>{
      posted=route.request().postDataJSON();
      assert.equal(purchaseReceiptSchema.safeParse(posted).success,true);
      assert.equal(posted.lines.find(line=>line.purchaseLineId===quantityLineId).serialNumbers.length,0);
      assert.deepEqual(posted.lines.find(line=>line.purchaseLineId===serialLineId).serialNumbers,["ECM-001"]);
      order.lines[0].received_quantity=2;order.lines[1].received_quantity=1;order.status="partially_received";order.version++;
      await route.fulfill({json:{recorded:true,replayed:false,receipt:{id:randomUUID(),units:[{serialNumber:"ECM-001"}],labelBatch:{itemCount:1}}}});
    });
    const page=await context.newPage(),errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:5173/${fixtureName}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button",{name:"Purchase orders",exact:true}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll("button")].some(button=>button.textContent?.trim()==="Receive items"&&button.offsetParent!==null),null,{timeout:5000});
    await page.getByRole("button",{name:"Receive items",exact:true}).evaluateAll(buttons=>{
      const visible=buttons.find(button=>button.offsetParent!==null);
      if(!visible)throw new Error("No visible receive action");
      visible.click();
    });
    const dialog=page.getByRole("dialog",{name:"Receive purchase order"});
    await dialog.waitFor();
    await dialog.getByLabel("Available now for line 1").fill("2");
    await dialog.getByLabel("Available now for line 2").fill("1");
    const serialInput=dialog.locator('textarea[aria-label^="Serialized identities"]');
    assert.equal(await serialInput.count(),1);
    await serialInput.fill("ECM-001");
    await page.screenshot({path:`.tmp/local-server/inventory-phase3-receiving-${width}.png`,fullPage:true});
    await dialog.getByRole("button",{name:"Post received items",exact:true}).click();
    await dialog.waitFor({state:"detached"});
    assert.ok(posted);
    assert.deepEqual(errors,[]);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    console.log(`Phase 3 mixed receipt passed at ${width}px`);
    await context.close();
  }
}finally{
  await browser.close();
  await unlink(fixtureUrl);
}
