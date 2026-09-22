import assert from 'node:assert/strict';
import { writeFile,unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const name=`po-bills-${randomUUID()}.html`,file=new URL(`../../frontend/${name}`,import.meta.url);
const locationId=randomUUID(),actorId=randomUUID(),orderId=randomUUID();
await writeFile(file,`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import '/src/typography.css';import '/src/styles.css';import {InventoryPurchases} from '/src/features/inventory/InventoryPurchases.jsx';createRoot(document.getElementById('root')).render(React.createElement(InventoryPurchases,{locations:[{id:'${locationId}',name:'Shop'}],actorId:'${actorId}'}));</script></body></html>`);
const browser=await chromium.launch({channel:'msedge',headless:true});
try{for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000}});
  try{
    const items=[],requests=[];
    const order={id:orderId,number:'PO-BILL-101',supplier_name:'ABC Parts',status:'received',version:1,currency:'USD',total:'78.00',expected_delivery_date:'2026-09-20',notes:'',lines:[]};
    await context.route('**/api/office/inventory/purchase-requests?*',r=>r.fulfill({json:{items:[],page:1,hasMore:false}}));
    await context.route('**/api/office/inventory/purchasing?*',r=>r.fulfill({json:{items:[order],suppliers:[],receipts:[],canApprove:false,page:1,hasMore:false}}));
    await context.route(`**/api/office/inventory/purchasing/${orderId}/bills`,async route=>{
      if(route.request().method()==='GET')return route.fulfill({json:{items}});
      const body=route.request().postDataJSON();requests.push(body);
      assert.equal(body.mimeType,'application/pdf');assert.equal(body.reference,'INV-101');
      assert.ok(body.dataUrl.startsWith('data:application/pdf;base64,'));
      const document={id:randomUUID(),file_name:body.fileName,mime_type:body.mimeType,byte_size:100,reference:body.reference,created_at:new Date().toISOString()};
      items.push(document);return route.fulfill({json:{document,replayed:false}});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://localhost:5173/${name}`);
    await page.getByRole('button',{name:'Purchase orders',exact:true}).click();
    assert.equal(await page.getByRole('tab',{name:'Bills',exact:true}).count(),0);
    await page.getByRole('button',{name:'Upload bill',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Upload bill',exact:true});await dialog.waitFor();
    await dialog.getByText('PO-BILL-101 · ABC Parts',{exact:true}).waitFor();
    await dialog.locator('input[type=file]').setInputFiles({name:'invoice.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nInvoice\n%%EOF')});
    await dialog.getByLabel('Invoice reference (optional)').fill('INV-101');
    await page.screenshot({path:`.tmp/local-server/po-bill-upload-${width}.png`,fullPage:true});
    await dialog.getByRole('button',{name:'Upload bill',exact:true}).click();
    await page.getByRole('link',{name:'invoice.pdf',exact:true}).waitFor();
    assert.equal(requests.length,1);
    assert.equal(order.status,'received');assert.equal(order.version,1);
    await page.keyboard.press('Escape');await page.reload();
    await page.getByRole('button',{name:'Purchase orders',exact:true}).click();
    await page.getByRole('button',{name:'PO-BILL-101',exact:true}).click();
    await page.getByRole('link',{name:'invoice.pdf',exact:true}).waitFor();
    assert.deepEqual(errors,[]);console.log(`Bill upload, PO link and reload passed at ${width}px`);
  }finally{await context.close();}
}}finally{await browser.close();await unlink(file);}
