import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const name=`po-approval-${randomUUID()}.html`,file=new URL(`../../frontend/${name}`,import.meta.url);
const locationId=randomUUID(),userId=randomUUID();
await writeFile(file,`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import '/src/typography.css';import '/src/styles.css';import '/src/features/admin/admin.css';import {PurchaseOrderApprovalSettings} from '/src/features/admin/workspace/PurchaseOrderApprovalSettings.jsx';createRoot(document.getElementById('root')).render(React.createElement(PurchaseOrderApprovalSettings,{locations:[{id:'${locationId}',name:'Shop'}]}));</script></body></html>`);
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  for (const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:1000}});
    try {
      let policy=null,saves=0;
      await context.route('**/api/office/inventory/purchasing/approval-settings?*',route=>route.fulfill({json:{policy,users:[{id:userId,name:'Office Manager',role:'office'}],roles:[{id:'office',name:'Office'},{id:'admin',name:'Admin'}]}}));
      await context.route('**/api/office/inventory/purchasing/approval-settings',async route=>{
        assert.equal(route.request().method(),'PUT');
        const body=route.request().postDataJSON();
        assert.equal(body.approvalLimit,'5000.00');
        assert.equal(body.locationId,locationId);
        assert.deepEqual(body.approverUserIds,[userId]);
        assert.deepEqual(body.approverRoles,['admin']);
        assert.equal(body.expectedVersion,0);
        policy={approval_limit:body.approvalLimit,currency:body.currency,approver_user_ids:body.approverUserIds,approver_roles:body.approverRoles,version:1};
        saves++;
        await route.fulfill({json:{policy,users:[{id:userId,name:'Office Manager',role:'office'}],roles:[{id:'office',name:'Office'},{id:'admin',name:'Admin'}]}});
      });
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`http://127.0.0.1:5173/${name}`);
      await page.getByRole('button',{name:'Manage',exact:true}).click();
      await page.getByLabel('Approval limit ($)',{exact:true}).fill('5000.00');
      await page.getByRole('checkbox',{name:'Office Manager (office)',exact:true}).check();
      await page.getByRole('checkbox',{name:'Admin role',exact:true}).check();
      await page.getByRole('button',{name:'Save approval settings'}).click();
      await page.getByRole('status').filter({hasText:'settings saved'}).waitFor();
      assert.equal(saves,1);
      await page.reload();
      await page.getByRole('button',{name:'Manage',exact:true}).click();
      await page.getByLabel('Approval limit ($)',{exact:true}).waitFor();
      assert.equal(await page.getByLabel('Approval limit ($)',{exact:true}).inputValue(),'5000.00');
      assert.equal(await page.getByRole('checkbox',{name:'Admin role',exact:true}).isChecked(),true);
      assert.equal(await page.getByRole('checkbox',{name:'Office Manager (office)',exact:true}).isChecked(),true);
      assert.deepEqual(errors,[]);
      await page.screenshot({path:`.tmp/local-server/po-approval-settings-${width}.png`,fullPage:true});
      console.log(`PO settings selection, save and reload passed at ${width}px`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); await unlink(file); }
