import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile,unlink } from 'node:fs/promises';
import { chromium } from 'playwright';

const fixtureName=`automatic-purchasing-demand-${randomUUID()}.html`;
const fixtureFile=new URL(`../../frontend/${fixtureName}`,import.meta.url);
const locationId='10000000-0000-4000-8000-000000000001';
const otherLocationId='10000000-0000-4000-8000-000000000009';
const partId='20000000-0000-4000-8000-000000000001';
const requestId='30000000-0000-4000-8000-000000000001';

await writeFile(fixtureFile,`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"/></head><body><div id="root"></div><script type="module">
import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';import '/src/typography.css';import '/src/styles.css';
import {InventoryPurchases} from '/src/features/inventory/InventoryPurchases.jsx';
function Harness(){const [locations,setLocations]=useState([]);useEffect(()=>{const timer=setTimeout(()=>setLocations([{id:'${otherLocationId}',name:'Other shop'},{id:'${locationId}',name:'Main shop'}]),10);return()=>clearTimeout(timer);},[]);return React.createElement(InventoryPurchases,{locations,actorId:'40000000-0000-4000-8000-000000000001',view:'purchases',onInvoice:()=>{},onStock:()=>{}});}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`);

const response={suppliers:[{id:'50000000-0000-4000-8000-000000000001',name:'Parts supplier'}],items:[],receipts:[],hasMore:false,page:1,canApprove:true,purchaseDefaults:{currency:'USD',approvalConfigured:true},demand:[{
  catalog_part_id:partId,part_number:'FILTER-100',description:'Engine filter',uom_code:'ea',tracking_mode:'quantity',
  buy_quantity:'5',source:'both',workorder_quantity:'3',legacy_quantity:'0',available_quantity:'2',on_hand_quantity:'4',reserved_quantity:'2',incoming_quantity:'1',minimum_available:'2',target_quantity:'5',
  workorders:[{requestId,workorderId:'60000000-0000-4000-8000-000000000001',workorderNumber:'WO-100',requestedQuantity:'3',uomCode:'ea'}],legacy_requests:[],
}]};
const browser=await chromium.launch({channel:process.env.QA_BROWSER_CHANNEL||'chrome',headless:true});
try {
  for(const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:390,height:844}]) {
    const context=await browser.newContext({viewport});
    try {
      let posted=false;
      await context.route('**/api/office/inventory/purchasing?**',route=>route.fulfill({status:200,json:response}));
      await context.route('**/api/office/inventory/purchasing',async route=>{
        const body=route.request().postDataJSON();
        posted=true;
        assert.equal(body.action,'create');assert.equal(body.placeOrder,true);assert.equal(body.locationId,locationId);assert.equal(body.supplierId,response.suppliers[0].id);
        assert.equal(body.lines.length,1);assert.equal(body.lines[0].catalogPartId,partId);assert.equal(body.lines[0].unitPrice,null);
        assert.deepEqual(body.lines[0].demandSources,[{sourceType:'stocking_policy',sourceId:partId,plannedQuantity:5}]);
        await route.fulfill({status:200,json:{order:{id:randomUUID(),number:'PO-COMPACT',supplier_name:'Parts supplier',supplier_id:response.suppliers[0].id,status:'awaiting_approval',version:1,currency:'USD',total:null,expected_delivery_date:null,notes:'',lines:[{id:randomUUID(),catalog_part_id:partId,part_number:'FILTER-100',description:'Engine filter',quantity:5,received_quantity:0,cancelled_quantity:0,uom_code:'ea',tracking_mode:'quantity',unit_price:null}]}}});
      });
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`http://localhost:5173/${fixtureName}`);
      await page.locator('.purchase-orders-page').waitFor();
      await page.getByRole('button',{name:'Other shop',exact:true}).click();
      await page.getByRole('option',{name:'Main shop',exact:true}).click();
      const demand=page.locator('.purchase-needs-section');
      if (!(await demand.getAttribute('open'))) await demand.locator('summary').click();
      await page.getByRole('button',{name:'FILTER-100',exact:true}).waitFor();
      assert.equal(await page.getByText('WO-100',{exact:true}).count(),1);
      await page.getByRole('button',{name:'FILTER-100',exact:true}).click();
      await page.getByText('Source breakdown',{exact:true}).waitFor();
      await page.keyboard.press('Escape');
      const checkbox=page.getByRole('checkbox',{name:'Select FILTER-100',exact:true});
      await checkbox.click();
      await page.getByRole('button',{name:'Create order from 1 selected',exact:true}).click();
      const draftDialog=page.getByRole('dialog',{name:'New purchase order',exact:true});
      await draftDialog.waitFor();
      await draftDialog.getByText(/FILTER-100.*5 ea.*Price unknown/).waitFor();
      assert.equal(await draftDialog.getByLabel('Expected Delivery Date',{exact:true}).isVisible(),false);
      assert.equal(await draftDialog.getByLabel('Currency',{exact:true}).isVisible(),false);
      await draftDialog.getByRole('button',{name:'Choose supplier'}).click();await page.getByRole('option',{name:'Parts supplier',exact:true}).click();
      await draftDialog.getByText('More details',{exact:true}).click();
      await draftDialog.getByRole('textbox',{name:'Notes (optional)',exact:true}).fill('Keep this demand draft');
      await draftDialog.getByRole('button',{name:'Close draft',exact:true}).click();
      await page.getByRole('button',{name:'New purchase order',exact:true}).click();
      await draftDialog.waitFor();
      await draftDialog.getByText('More details',{exact:true}).click();
      assert.equal(await draftDialog.getByRole('textbox',{name:'Notes (optional)',exact:true}).inputValue(),'Keep this demand draft');
      await page.reload();
      await draftDialog.waitFor();
      assert.equal((await page.locator('.purchase-orders-toolbar .dropdown-select-trigger').textContent()).trim(),'Main shop','Recovered demand must restore its own shop before draft loading');
      await draftDialog.getByText('More details',{exact:true}).click();
      assert.equal(await draftDialog.getByRole('textbox',{name:'Notes (optional)',exact:true}).inputValue(),'Keep this demand draft');
      await draftDialog.getByRole('button',{name:'Place order',exact:true}).focus();await page.keyboard.press('Enter');
      await draftDialog.waitFor({state:'hidden'});
      assert.equal(posted,true);
      await page.getByRole('button',{name:'New purchase order',exact:true}).click();
      const exceptional=page.getByRole('dialog',{name:'New purchase order',exact:true});
      await exceptional.getByRole('combobox',{name:'Part number or description'}).waitFor();
      await exceptional.getByRole('button',{name:'Close purchase order',exact:true}).click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Purchases must fit ${viewport.width}px`);
      assert.deepEqual(errors,[]);
      console.log(`Automatic purchasing demand passed at ${viewport.width}x${viewport.height}`);
    } finally { await context.close(); }
  }
} finally { await browser.close();await unlink(fixtureFile); }
