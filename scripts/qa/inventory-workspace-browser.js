import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base=process.env.QA_BASE_URL||'http://localhost:5173';
if(!process.env.QA_RECEIPT_EMAIL||!process.env.QA_RECEIPT_PASSWORD)throw new Error('Set QA_RECEIPT_EMAIL and QA_RECEIPT_PASSWORD.');
const browser=await chromium.launch({channel:process.env.QA_BROWSER_CHANNEL||'msedge',headless:true});
try{
 for(const viewport of [{width:1440,height:1000},{width:820,height:1180},{width:390,height:844}]){
  const context=await browser.newContext({viewport});try{
   const login=await context.request.post(`${base}/api/auth/sign-in/email`,{headers:{Origin:base},data:{email:process.env.QA_RECEIPT_EMAIL,password:process.env.QA_RECEIPT_PASSWORD}});assert.equal(login.status(),200);
   const page=await context.newPage(),errors=[],failed=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().includes('/api/office/inventory/')&&r.status()>=400)failed.push(`${r.status()} ${r.url()}`);});
   await page.goto(`${base}/?view=inventory&adminView=inventory`);
   const nav=page.getByRole('group',{name:'Inventory sections',exact:true});await nav.waitFor();
   assert.equal(await nav.getByRole('button').count(),5);
   for(const view of ['Purchases','Tasks','Reports']){
    await nav.getByRole('button',{name:view,exact:true}).click();
    if(view==='Purchases'){
     const purchaseViews=page.getByRole('group',{name:'Purchases views',exact:true});
     await purchaseViews.getByRole('button',{name:'Needs ordering',exact:true}).waitFor();
     await purchaseViews.getByRole('button',{name:'Purchase orders',exact:true}).click();
     const purchaseTabs=page.getByRole('group',{name:'Purchase status',exact:true});
     await purchaseTabs.getByRole('button',{name:'All purchases',exact:true}).click();
     await page.getByRole('heading',{name:'Purchase orders',exact:true}).waitFor();
     await page.getByRole('button',{name:'New purchase',exact:true}).click();await page.getByRole('button',{name:'Save draft',exact:true}).waitFor();
     await page.getByRole('button',{name:'Close draft',exact:true}).click();
     await purchaseTabs.getByRole('button',{name:'Bills',exact:true}).click();
     await page.getByRole('button',{name:'Record supplier bill',exact:true}).click();await page.getByRole('heading',{name:'Bill details',exact:true}).waitFor();
    }
    if(view==='Tasks'){
     const tasks=page.getByRole('group',{name:'Inventory tasks',exact:true});
     for(const label of ['Stock damage','Transfers','Cycle counts']){await tasks.getByRole('button',{name:label,exact:true}).click();await page.getByRole('button',{name:label==='Stock damage'?'Mark stock damaged':label==='Transfers'?'Dispatch transfer':'Record count',exact:true}).waitFor();}
    }
    if(view==='Reports')await page.getByRole('heading',{name:'Stock and usage',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${view} must fit ${viewport.width}px`);
   }
   assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
   console.log(`Inventory views passed at ${viewport.width}x${viewport.height}`);
  }finally{await context.close();}
 }
}finally{await browser.close();}
