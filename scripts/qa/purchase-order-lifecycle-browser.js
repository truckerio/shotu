import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
const name=`po-lifecycle-${randomUUID()}.html`,file=new URL(`../../frontend/${name}`,import.meta.url);
const locationId=randomUUID(),actorId=randomUUID();
await writeFile(file,`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import '/src/typography.css';import '/src/styles.css';import {InventoryPurchases} from '/src/features/inventory/InventoryPurchases.jsx';createRoot(document.getElementById('root')).render(React.createElement(InventoryPurchases,{locations:[{id:'${locationId}',name:'Shop'}],actorId:'${actorId}'}));</script></body></html>`);
const browser=await chromium.launch({channel:'msedge',headless:true});
try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:1000}});
 try{
 let canApprove=false;
 const order={id:randomUUID(),number:'PO-TEST',supplier_name:'Supplier',status:'awaiting_approval',version:1,currency:'USD',total:'8000.00',expected_delivery_date:'2026-09-20',notes:'',lines:[{id:randomUUID(),catalog_part_id:randomUUID(),part_number:'FILTER',description:'Oil filter',quantity:2,received_quantity:0,cancelled_quantity:0,uom_code:'ea',current_uom_code:'ea',tracking_mode:'quantity',part_version:1,unit_price:null}]};
 await context.route('**/api/office/inventory/purchase-requests?*',r=>r.fulfill({json:{items:[],page:1,hasMore:false}}));
 await context.route('**/api/office/inventory/purchasing?*',r=>r.fulfill({json:{items:[order],suppliers:[],receipts:[],canApprove,page:1,hasMore:false}}));
 await context.route('**/api/office/inventory/purchasing',async r=>{const body=r.request().postDataJSON();assert.equal(body.expectedVersion,order.version);if(body.action==='approve')order.status='ordered';else{assert.equal(body.action,'receive');assert.equal(body.confirmation,'all_ordered_goods_received');assert.equal(body.deliveryCondition,width===390?'damaged':'undamaged');order.delivery_condition=body.deliveryCondition;order.delivery_damage_details=body.damageDetails;order.status='received';}order.version++;await r.fulfill({json:{order}});});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://localhost:5173/${name}`);
 await page.getByRole('button',{name:'Purchase orders',exact:true}).click();
 await page.getByRole('button',{name:'Refresh purchases',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Refresh purchases',exact:true}).innerText(),'');
 await page.getByRole('button',{name:/PO-TEST/}).click();
 await page.waitForTimeout(400);
 await page.screenshot({path:`.tmp/local-server/purchase-detail-${width}.png`,fullPage:true});
 assert.equal(await page.getByRole('button',{name:'Receive Order'}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Approve',exact:true}).count(),0);
 canApprove=true;
 await page.getByRole('button',{name:'Approve',exact:true}).click();
 await page.getByRole('button',{name:'Receive Order'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Approve',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Add to inventory',exact:true}).count(),0);
 await page.getByRole('button',{name:'Receive Order',exact:true}).click();
 await page.getByRole('dialog',{name:'Confirm delivery',exact:true}).waitFor();
 if(width===390){await page.getByRole('button',{name:/Received condition/}).click();await page.getByRole('option',{name:'Damaged items',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Confirm received',exact:true}).isDisabled(),true);await page.getByLabel('Damage details',{exact:false}).fill('One filter housing is dented.');}
 await page.getByRole('button',{name:'Confirm received',exact:true}).click();
 await page.getByRole('button',{name:'Add to inventory',exact:true}).waitFor();
 assert.equal(await page.locator('.purchase-order-detail').count(),0);
 await page.getByRole('button',{name:'Add to inventory',exact:true}).click();
 await page.locator('.purchase-order-detail').getByRole('button',{name:'Add to inventory',exact:true}).waitFor();
 assert.equal(order.lines[0].received_quantity,0);
 if(width===390)await page.getByText('One filter housing is dented.',{exact:true}).waitFor();
 order.lines[0].received_quantity=2;order.version++;
 await page.getByText('All received parts have been added to inventory.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Add to inventory',exact:true}).count(),0);
 assert.deepEqual(errors,[]);console.log(`PO approval, placement and live receipt status passed at ${width}px`);
 }finally{await context.close();}
}}finally{await browser.close();await unlink(file);}
