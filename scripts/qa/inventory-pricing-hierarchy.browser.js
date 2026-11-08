// Authenticated Stock hierarchy regression. Run only through the disposable DB runner.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const database = new URL(process.env.DATABASE_URL || '');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(database.hostname) && /^\/inspection_maintenance_test_[a-f0-9]{32}$/.test(database.pathname), 'Requires runner disposable loopback database');
const port = Number(process.env.QA_PRICING_HIERARCHY_PORT || 4208);
const base = `http://localhost:${port}`;
const artifacts = await mkdtemp(join(tmpdir(), 'pricing-hierarchy-'));
Object.assign(process.env, { PORT:String(port), BETTER_AUTH_URL:base, AUTH_TRUSTED_ORIGINS:base, NODE_ENV:'development', SAMSARA_SYNC_ON_STARTUP:'false', WORKORDER_STORAGE_DIR:artifacts });
const { getPool, closePool } = await import('../../src/server/db/pool.js');
const { seedInspectionMaintenanceBase } = await import('./inspection-maintenance-fixture.js');
const { auth } = await import('../../src/server/auth/auth.js');
const pool = getPool();
const f = await seedInspectionMaintenanceBase(pool);
const partId = randomUUID(), secondLocation = randomUUID(), batchId = randomUUID(), otherBatch = randomUUID();
await pool.query("update user_company_memberships set role='admin' where user_id=$1", [f.officeId]);
await pool.query("insert into locations(id,company_id,name) values($1,$2,'Second shop')", [secondLocation,f.companyId]);
await pool.query("insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode) values($1,$2,'HIERARCHY-001','HIERARCHY-001','Hierarchy fixture','ea','quantity')", [partId,f.companyId]);
for (const [id, location, cost] of [[batchId,f.locationId,'7'],[otherBatch,secondLocation,'9']]) {
  await pool.query("insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id) values($1,$2,$3,'HIERARCHY-001','HIERARCHY-001','Hierarchy fixture',5,0,'ea','local',$4)", [f.companyId,location,partId,`hierarchy:${id}`]);
  await pool.query("insert into inventory_aggregate_cost_layers(id,company_id,location_id,catalog_part_id,source_kind,received_quantity,quantity_on_hand,uom_code,unit_cost,currency,cost_source,received_at) values($1,$2,$3,$4,'legacy_unassigned',5,5,'ea',$5,'USD','manual',now())", [id,f.companyId,location,partId,cost]);
}
const credentials = {};
for (const [name,id] of [['admin',f.officeId],['mechanic',f.mechanicId],['other',f.otherOfficeId]]) {
  const username = `hierarchy${name}${randomUUID().replaceAll('-','').slice(0,8)}`;
  const password = `Hierarchy-${randomUUID()}!`, email = `${username}@example.test`;
  const account = await auth.api.signUpEmail({body:{name, email, username, displayUsername:username, password}});
  await pool.query('update user_profiles set auth_user_id=$2,contact_email=$3 where id=$1',[id,account.user.id,email]);
  credentials[name]={username,password};
}
const server=spawn(process.execPath,['server.js'],{env:process.env,stdio:['ignore','pipe','pipe']});
let log=''; server.stdout.on('data',x=>{log+=x;}); server.stderr.on('data',x=>{log+=x;});
let browser;
try {
  for(let i=0;i<100;i++){ if(server.exitCode!==null) throw new Error(log); try{if((await fetch(`${base}/health/live`)).ok) break;}catch{} if(i===99) throw new Error('Server not ready'); await new Promise(r=>setTimeout(r,100)); }
  browser=await chromium.launch({headless:true});
  async function login(role,width=1440){
    const context=await browser.newContext({viewport:{width,height:900}}), page=await context.newPage(); page.setDefaultTimeout(15000);
    await page.goto(base); await page.getByLabel('Username or email',{exact:true}).fill(credentials[role].username); await page.locator('#login-password').fill(credentials[role].password); await page.getByRole('button',{name:'Sign in',exact:true}).click(); await page.locator('#login-password').waitFor({state:'hidden'}); return {context,page};
  }
  const {context,page}=await login('admin');
  const root=`/api/office/inventory/parts/${partId}`;
  async function api(ctx,path,body,status=200){
    const response=await ctx.request.fetch(`${base}${path}`,{method:body?'PUT':'GET',data:body});
    const json=await response.json(); assert.equal(response.status(),status,`${path}: ${JSON.stringify(json)}`); return json;
  }
  const key=()=>randomUUID();
  const missing=await api(context,`${root}/commercial?locationId=${f.locationId}`);
  assert.equal(missing.prices.internal.effective,null,'missing internal differs from known zero');
  assert.equal((await api(context,`${root}/selling-policy?locationId=${f.locationId}`)).policy,null,'missing selling rate remains absent');
  const companyInternal={expectedVersion:0,amount:'0',currency:'USD',reason:'Company internal zero',idempotencyKey:key()};
  const companySelling={expectedVersion:0,method:'fixed',value:'25',currency:'USD',reason:'Company selling default',idempotencyKey:key()};
  await api(context,`${root}/prices/internal`,companyInternal);
  await api(context,`${root}/selling-policy`,companySelling);
  const commercial=(location)=>api(context,`${root}/commercial?locationId=${location}`);
  const policy=(location)=>api(context,`${root}/selling-policy?locationId=${location}`);
  let c=await commercial(f.locationId), p=await policy(f.locationId);
  assert.equal(Number(c.prices.internal.effective.amount),0,'known zero inherits as a real internal rate');
  assert.equal(Number(p.policy.value),25,'selling rate inherits company default');
  assert.equal(p.policy.locationId,null);
  const internalPath=`${root}/locations/${f.locationId}/prices/internal`, sellingPath=`${root}/selling-policy?locationId=${f.locationId}`;
  await api(context,internalPath,{expectedVersion:0,amount:'11',currency:'USD',reason:'Local internal override',idempotencyKey:key()});
  await api(context,sellingPath,{expectedVersion:0,method:'fixed',value:'31',currency:'USD',reason:'Local selling override',idempotencyKey:key()});
  c=await commercial(f.locationId); p=await policy(f.locationId);
  assert.equal(Number(c.prices.internal.effective.amount),11); assert.equal(Number(p.policy.value),31);
  assert.equal(Number((await commercial(secondLocation)).prices.internal.effective.amount),0,'override does not affect another location');
  assert.equal(Number((await policy(secondLocation)).policy.value),25);
  let companyView=await api(context,`${root}/selling-policy`);
  let row=companyView.locationRates.find(item=>item.locationId===f.locationId);
  assert.equal(row.internal.source,'location_override'); assert.equal(Number(row.internal.amount),11);
  assert.equal(row.selling.source,'location_override'); assert.equal(Number(row.selling.value),31);
  const resetInternal={useCompanyDefault:true,expectedVersion:1,reason:'Restore company internal',idempotencyKey:key()};
  const resetSelling={useCompanyDefault:true,expectedVersion:1,reason:'Restore company selling',idempotencyKey:key()};
  await api(context,internalPath,resetInternal); await api(context,internalPath,resetInternal);
  await api(context,sellingPath,resetSelling); await api(context,sellingPath,resetSelling);
  c=await commercial(f.locationId); p=await policy(f.locationId);
  assert.equal(Number(c.prices.internal.effective.amount),0); assert.equal(c.prices.internal.usesCompanyDefault,true);
  assert.equal(Number(p.policy.value),25); assert.equal(p.usesCompanyDefault,true);
  assert.equal(c.prices.internal.writeVersion,2); assert.equal(p.writeVersion,2);
  companyView=await api(context,`${root}/selling-policy`); row=companyView.locationRates.find(item=>item.locationId===f.locationId);
  assert.equal(row.internal.source,'company_default'); assert.equal(Number(row.internal.amount),0);
  assert.equal(row.selling.source,'company_default'); assert.equal(Number(row.selling.value),25);
  await api(context,internalPath,{...resetInternal,idempotencyKey:key()},409);
  await api(context,sellingPath,{...resetSelling,idempotencyKey:key()},409);
  const internalAudit=(await pool.query("select version,reason,created_by from inventory_part_price_versions where catalog_part_id=$1 and location_id=$2 order by version",[partId,f.locationId])).rows;
  const sellingAudit=(await pool.query("select version,reason,created_by from inventory_part_selling_policy_versions where catalog_part_id=$1 and location_id=$2 order by version",[partId,f.locationId])).rows;
  for(const [rows,reason] of [[internalAudit,resetInternal.reason],[sellingAudit,resetSelling.reason]]) { assert.equal(rows.length,2,'retry must not append another version'); assert.equal(rows[1].reason,reason); assert.equal(rows[1].created_by,f.officeId); }
  async function rejectsConstraint(sql,params){ await assert.rejects(pool.query(sql,params), error=>error.code==='23514', 'invalid inheritance shape must violate a check constraint'); }
  const invalidPolicy=`insert into inventory_part_selling_policy_versions(company_id,catalog_part_id,location_id,version,method,value,currency,reason,created_by,idempotency_key,request_hash,uses_company_default) values($1,$2,$3,999,$4,$5,$6,'Invalid shape test',$7,$8,$9,$10)`;
  for(const [loc,method,value,currency,inherit] of [[f.locationId,null,'1','USD',false],[f.locationId,'fixed','1',null,false],[null,null,null,null,true]]) {
    await rejectsConstraint(invalidPolicy,[f.companyId,partId,loc,method,value,currency,f.officeId,key(),'a'.repeat(64),inherit]);
  }
  await rejectsConstraint(`insert into inventory_part_price_versions(company_id,catalog_part_id,location_id,price_kind,version,amount,currency,reason,created_by,idempotency_key,request_hash,uses_company_default,tax_treatment) values($1,$2,null,'internal',999,null,null,'Invalid shape test',$3,$4,$5,true,'not_configured')`,[f.companyId,partId,f.officeId,key(),'b'.repeat(64)]);
  console.log('PASS migration rejects invalid inheritance shapes');
  const denied=await login('mechanic');
  await api(denied.context,internalPath,{...resetInternal,idempotencyKey:key()},403);
  await api(denied.context,sellingPath,{...resetSelling,idempotencyKey:key()},403);
  await denied.context.close();
  const foreign=await login('other');
  const foreignResponse=await foreign.context.request.put(`${base}${internalPath}`,{data:{...resetInternal,idempotencyKey:key()}});
  assert.ok([403,404].includes(foreignResponse.status()),'other tenant cannot change a rate'); await foreign.context.close();
  const costs=(await pool.query('select id,unit_cost from inventory_aggregate_cost_layers where id=any($1::uuid[]) order by id',[[batchId,otherBatch]])).rows;
  assert.deepEqual(costs.map(x=>Number(x.unit_cost)).sort((a,b)=>a-b),[7,9],'rate changes preserve batch costs');
  console.log('PASS real API inheritance, override, reset, version, retry, audit, tenant and role boundaries');
  await page.goto(`${base}/?adminView=inventory&inventorySection=stock&stockMode=part`);
  await page.getByRole('row',{name:/Open details for HIERARCHY-001/}).click();
  const panel=page.getByRole('dialog');
  const rates=panel.getByRole('region',{name:'Configured rates',exact:true}); await rates.waitFor();
  assert.equal(await panel.locator('.inventory-batch-row').count(),0,'company overview must not show individual location batches');
  console.log('PASS company overview hides batches');
  await page.locator('.secondary-detail-modal[data-entering]').waitFor({state:'detached'});
  await page.screenshot({path:join(artifacts,'company-1440.png')});
  assert.match(await rates.innerText(),/\$0\.00/); assert.match(await rates.innerText(),/\$25\.00/);
  await panel.getByRole('button',{name:/Maintenance shop/}).first().click();
  const locationRates=panel.getByRole('region',{name:'Configured rates',exact:true}); await locationRates.waitFor();
  const batch=panel.locator('.inventory-batch-row'); await batch.first().waitFor();
  assert.equal(await batch.count(),1,'location view contains only its own batch');
  assert.match(await batch.innerText(),/\$7\.00/); assert.doesNotMatch(await batch.innerText(),/\$9\.00/);
  assert.ok(await locationRates.evaluate((node)=>Boolean(node.compareDocumentPosition(document.querySelector('.inventory-batch-list')) & Node.DOCUMENT_POSITION_FOLLOWING)),'rates precede batches');
  async function changeRate(kind, action, value) {
    await locationRates.getByRole('button',{name:'Set location rates',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Set location rates',exact:true});
    await dialog.getByRole('button',{name:'Rate type'}).click();
    await page.getByRole('option',{name:kind,exact:true}).click();
    await dialog.getByLabel('Reason',{exact:true}).fill(`UI ${action} ${kind}`);
    if(action==='override') {
      await dialog.getByLabel('Amount',{exact:true}).fill(value);
      await dialog.getByRole('button',{name:'Save',exact:true}).click();
    } else if(kind==='Internal price') {
      const submitted=[]; let lost=true;
      const handler=async route=>{
        submitted.push(route.request().postDataJSON());
        if(lost){lost=false; await route.fetch(); await route.abort('failed');} else await route.continue();
      };
      await page.route(`**${internalPath}`,handler);
      const before=(await commercial(f.locationId)).prices.internal.writeVersion;
      await dialog.getByRole('button',{name:'Use company default',exact:true}).click();
      await dialog.getByRole('alert').waitFor();
      assert.equal(await dialog.getByLabel('Reason',{exact:true}).inputValue(),`UI ${action} ${kind}`,'failed response preserves reason');
      await dialog.getByRole('button',{name:'Use company default',exact:true}).click();
      await dialog.waitFor({state:'hidden'}); await page.unroute(`**${internalPath}`,handler);
      assert.equal(submitted.length,2); assert.equal(submitted[0].idempotencyKey,submitted[1].idempotencyKey,'retry reuses idempotency key');
      assert.equal((await commercial(f.locationId)).prices.internal.writeVersion,before+1,'lost response retry appends only one version');
    } else await dialog.getByRole('button',{name:'Use company default',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
  }
  for(const [kind,value] of [['Internal price','12'],['Selling price','32']]) {
    await changeRate(kind,'override',value);
    assert.match(await locationRates.innerText(),new RegExp(`\\$${value}\\.00`));
    await changeRate(kind,'reset');
  }
  assert.equal(Number((await commercial(f.locationId)).prices.internal.effective.amount),0);
  assert.equal(Number((await policy(f.locationId)).policy.value),25);
  await page.reload();
  await page.getByRole('row',{name:/Open details for HIERARCHY-001/}).click();
  await panel.getByRole('button',{name:/Maintenance shop/}).first().click();
  await locationRates.waitFor();
  assert.match(await locationRates.innerText(),/\$0\.00/); assert.match(await locationRates.innerText(),/\$25\.00/);
  console.log('PASS UI independent overrides, resets and persistence on reload');

  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:900});
    await page.locator('.secondary-detail-modal[data-entering]').waitFor({state:'detached'});
    const geometry=await panel.evaluate(node=>({left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right,scroll:node.scrollWidth,client:node.clientWidth,page:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}));
    assert.ok(geometry.left>=-1 && geometry.right<=width+1 && geometry.scroll<=geometry.client+1 && geometry.page<=geometry.viewport+1,`no horizontal overflow ${width}: ${JSON.stringify(geometry)}`);
    await page.screenshot({path:join(artifacts,`location-${width}.png`)});
  }
  await context.close();
  console.log(`Artifacts: ${artifacts}`);
} catch(error){console.error(error);console.error(`Artifacts: ${artifacts}\n${log.slice(-2000)}`);process.exitCode=1;}
finally{await browser?.close();server.kill('SIGTERM');await new Promise(resolve=>{if(server.exitCode!==null)resolve();else{server.once('exit',resolve);setTimeout(resolve,3000);}});if(server.exitCode===null)server.kill('SIGKILL');await closePool();}
