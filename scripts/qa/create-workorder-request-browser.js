import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
const name=`create-request-qa-${randomUUID()}.html`,file=new URL(`../../frontend/${name}`,import.meta.url);
const locationId=randomUUID(),actorId=randomUUID();
await writeFile(file,`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"/></head><body><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';import '/src/typography.css';import '/src/styles.css';
import {CreatePartsModule} from '/src/features/workorder-modules/parts/CreatePartsModule.jsx';
function Test(){const [parts,setParts]=React.useState([{partNo:'heirio',qty:'2',uomCode:'pc',repairOrder:''}]);return React.createElement(CreatePartsModule,{actorId:'${actorId}',actorRole:'office',locationId:'${locationId}',access:'write',activeSection:'parts',parts,onChange:(index,value)=>setParts(p=>p.map((part,i)=>i===index?{...part,...value}:part)),onAdd:()=>{},onRemove:()=>{},onLaborHoursChange:()=>{},onLaborRepairOrderChange:()=>{}});}
createRoot(document.getElementById('root')).render(React.createElement(Test));
</script></body></html>`);
const browser=await chromium.launch({channel:process.env.QA_BROWSER_CHANNEL||'msedge',headless:true});
try{
 for(const width of [1440,768,390]){
  const context=await browser.newContext({viewport:{width,height:1000}});
  try{
   let legacyRequests=0;const errors=[];
   await context.route('**/api/office/inventory/purchase-requests',async route=>{legacyRequests++;await route.fulfill({status:410,json:{code:'PURCHASE_REQUESTS_READ_ONLY'}});});
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.goto(`http://localhost:5173/${name}`);
   await page.getByRole('button',{name:'Request part',exact:true}).click();
   await page.getByRole('status').filter({hasText:'Part request will be created when this Workorder is saved'}).waitFor();
   assert.equal(legacyRequests,0);
   assert.deepEqual(errors,[]);
   console.log(`Create work order Request part passed at ${width}px`);
  }finally{await context.close();}
 }
}finally{await browser.close();await unlink(file);}
