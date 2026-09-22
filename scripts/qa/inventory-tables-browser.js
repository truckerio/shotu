import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import {chromium} from 'playwright';
const file=new URL('../../frontend/inventory-table-check.html',import.meta.url);
await writeFile(file,`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from 'react';import{createRoot}from'react-dom/client';import '/src/typography.css';import '/src/styles.css';import '/src/features/inventory/inventory-workspace.css';
import{InventoryReports}from'/src/features/inventory/InventoryReports.jsx';import{InventoryStockTasks}from'/src/features/inventory/InventoryStockTasks.jsx';import{OperationalCollectionTable as Table,OperationalCollectionRow as Row,OperationalCollectionCell as Cell}from'/src/components/operations/OperationalCollectionPage.jsx';import{OperationalDataTable as Data,OperationalDataRow as DataRow,OperationalDataCell as DataCell}from'/src/components/ui/OperationalDataTable.jsx';
const h=React.createElement,cols=['Part','Available','Reserved','Installed'];createRoot(document.getElementById('root')).render(h('main',{style:{padding:16,minWidth:0}},h(Table,{className:'inventory-stock-table inventory-data-table',ariaLabel:'Stock',columns:cols.map(x=>({id:x,label:x}))},h(Row,{className:'inventory-stock-row',onAction:()=>document.body.dataset.opened='yes'},...cols.map((x,i)=>h(Cell,{key:x,label:x},i?'12':'PART-101')))),h(Data,{className:'inventory-count-review-table inventory-data-frame',ariaLabel:'Review',columns:cols.map((x,i)=>({id:x,label:x,isRowHeader:i===0}))},h(DataRow,{id:'1'},...cols.map(x=>h(DataCell,{key:x,label:x},x)))),h(InventoryStockTasks,{locations:[{id:'shop',name:'Shop'}],actorId:'test',kind:'transfer'}),h(InventoryReports,{locations:[{id:'shop',name:'Shop'}]})));
</script></body></html>`);
const browser=await chromium.launch({channel:'msedge',headless:true});
try{for(const width of [1440,820,390]){const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/office/inventory/stock-tasks?*',r=>r.fulfill({json:{items:[{id:'task',part_number:'PART-101',quantity:2,uom_code:'ea',status:'in_transit',holder:'Courier',destination_name:'Workshop',kind:'transfer',units:[],events:[]}],hasMore:false}}));
await page.route('**/api/office/inventory/reports?*',r=>r.fulfill({json:{stock:[{id:'part',part_number:'PART-101',description:'Replacement assembly',uom_code:'ea',physical_on_hand:12,held_quantity:0,quantity_reserved:2,available:10,used_last_30_days:4}],commitments:[{currency:'USD',priced_commitment:400,orders:2,unpriced_lines:0}],transit:[{part_number:'PART-101',quantity:2,uom_code:'ea',destination:'Workshop',holder:'Courier'}],bills:[{currency:'USD',outstanding:100,overdue:0}],costCoverage:{unknown_cost_lines:0,receipt_lines:4}}}));
await page.goto('http://127.0.0.1:5173/inventory-table-check.html');await page.getByRole('table',{name:'Supplier money outstanding',exact:true}).waitFor();

for(const name of ['Stock','Review','Transfers','Stock and usage','Open purchasing commitments','In transit','Supplier money outstanding']){
const t=page.getByRole(name==='Review'?'grid':'table',{name,exact:true});await t.waitFor();assert.equal(await t.getByRole('columnheader').first().isVisible(),true,name);
if(name==='Review')assert.equal(await t.locator('thead').evaluate(e=>getComputedStyle(e).clipPath),'none');
const cell=t.locator('td,[role=cell]').first();if(await cell.count())assert.equal(await cell.evaluate(e=>getComputedStyle(e).fontSize),'13px',name);
}
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`page fits ${width}`);
assert.equal(await page.locator('.inventory-stock-row [role=cell]').nth(1).isVisible(),true);
await page.locator('.inventory-stock-row').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('body').getAttribute('data-opened'),'yes');
await page.screenshot({path:`.tmp/local-server/inventory-tables-${width}.png`,fullPage:true});
await page.getByRole('button',{name:'PART-101',exact:true}).click();await page.getByRole('dialog').waitFor();assert.deepEqual(errors,[]);console.log(`Inventory tables and actions passed at ${width}px`);await page.close();}}
finally{await browser.close();await unlink(file);}
