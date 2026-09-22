import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
const name=`po-lifecycle-${randomUUID()}.html`,file=new URL(`../../frontend/${name}`,import.meta.url);
const locationId=randomUUID(),actorId=randomUUID();
await writeFile(file,`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import '/src/typography.css';import '/src/styles.css';import {InventoryPurchases} from '/src/features/inventory/InventoryPurchases.jsx';createRoot(document.getElementById('root')).render(React.createElement(InventoryPurchases,{locations:[{id:'${locationId}',name:'Shop'}],actorId:'${actorId}'}));</script></body></html>`);
const browser=await chromium.launch({channel:process.env.QA_BROWSER_CHANNEL||'chrome',headless:true});
try{for(const width of [1440,768,390]){
 const context=await browser.newContext({viewport:{width,height:1000}});
 try{
 const supplierId=randomUUID(),partId=randomUUID();
 let posted=false;
 const order={id:randomUUID(),number:'PO-TEST',supplier_name:'Supplier',status:'awaiting_approval',version:1,currency:'USD',total:'78.00',expected_delivery_date:'2026-09-20',notes:'',lines:[{id:randomUUID(),catalog_part_id:randomUUID(),part_number:'FILTER',description:'Oil filter',quantity:2,received_quantity:0,cancelled_quantity:0,uom_code:'ea',current_uom_code:'ea',tracking_mode:'quantity',part_version:1,unit_price:null}]};
 await context.route('**/api/office/inventory/purchase-requests?*',r=>r.fulfill({json:{items:[],page:1,hasMore:false}}));
 await context.route('**/api/office/inventory/purchasing?*',r=>r.fulfill({json:{items:[order],suppliers:[{id:supplierId,name:'Supplier'}],receipts:[],demand:[],purchaseDefaults:{currency:'USD',approvalConfigured:true},canApprove:true,page:1,hasMore:false}}));
 await context.route('**/api/office/inventory/catalog?*',r=>r.fulfill({json:{items:[]}}));
 await context.route('**/api/office/inventory/parts',r=>r.fulfill({json:{part:{id:partId,partNumber:'ITS GODD',description:'ITS GODD',uomCode:'ea',trackingMode:'quantity'}}}));
 await context.route('**/api/office/inventory/purchasing',async r=>{const body=r.request().postDataJSON();if(body.action==='create'){posted=true;assert.equal(body.lines[0].catalogPartId,undefined);assert.equal(body.lines[0].partNumber,'ITS GODD');assert.equal(body.lines[0].unitPrice,'39');assert.equal(body.lines.length,1);assert.equal(body.placeOrder,true);assert.equal(body.expectedDeliveryDate,null);order.status='ordered';await r.fulfill({json:{order}});return;}assert.equal(body.expectedVersion,order.version);if(body.action==='approve')order.status='ordered';else{assert.equal(body.action,'place');assert.equal(body.reason,'Supplier reference 123');order.status='ordered';order.communication_reference=body.reason;}order.version++;await r.fulfill({json:{order}});});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://localhost:5173/${name}`);
 await page.getByRole('button',{name:'Purchase orders',exact:true}).click();

 assert.equal(await page.locator('#purchase-order-filters').count(),0);
 await page.getByRole('button',{name:'Filters',exact:true}).click();
 const filtered=page.waitForRequest(request=>request.url().includes('query=PO-TEST'));
 await page.getByRole('searchbox').fill('PO-TEST');
 await filtered;
 await page.getByRole('button',{name:'Clear',exact:true}).click();
 await page.getByRole('button',{name:'Filters',exact:true}).click();
 await page.screenshot({path:`.tmp/local-server/po-table-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'New purchase order',exact:true}).click();
 await page.getByRole('dialog',{name:'New purchase order',exact:true}).waitFor();
 await page.screenshot({path:`.tmp/local-server/po-compact-form-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Save / Place Order',exact:true}).click();
 await page.getByRole('dialog',{name:'Complete the required details'}).waitFor();
 await page.screenshot({path:`.tmp/local-server/po-required-dialog-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Review fields'}).click();
 await page.getByRole('button',{name:'Choose supplier'}).click();await page.getByRole('option',{name:'Supplier',exact:true}).click();
 await page.getByRole('combobox',{name:'Part number or description'}).fill('ITS GODD');
 await page.getByLabel('Unit price',{exact:true}).fill('F');
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await page.getByRole('dialog',{name:'Complete the required details'}).waitFor();
 await page.getByRole('button',{name:'Review fields'}).click();
 assert.equal(await page.getByRole('button',{name:'Create new part',exact:true}).count(),0);
 await page.getByLabel('Unit price',{exact:true}).fill('39');
 await page.getByRole('button',{name:'Save / Place Order',exact:true}).click();
 await page.getByRole('dialog',{name:'New purchase order',exact:true}).waitFor({state:'hidden'});
 assert.equal(posted,true);
 assert.deepEqual(errors,[]);console.log(`PO uncatalogued ordering, price validation and draft save passed at ${width}px`);
 }finally{await context.close();}
}}finally{await browser.close();await unlink(file);}
