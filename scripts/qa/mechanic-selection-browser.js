import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
const name=`mechanic-check-${randomUUID()}.html`,file=new URL(`../../frontend/${name}`,import.meta.url);
await writeFile(file,`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"/></head><body><div id="root"></div><script type="module">
import React from 'react';import{createRoot}from'react-dom/client';import '/src/typography.css';import '/src/styles.css';import{CreateAssignmentModule}from'/src/features/workorder-modules/assignment/CreateAssignmentModule.jsx';
function Test(){const [ids,setIds]=React.useState([]);return React.createElement('form',{onSubmit:e=>{e.preventDefault();document.body.dataset.submitted='yes'},style:{padding:24}},React.createElement(CreateAssignmentModule,{access:'write',activeSection:'assignment',presentation:'one-page',assignment:{mechanics:[{id:'a',name:'Mechanic A'},{id:'b',name:'Mechanic B'}],mechanicUserIds:ids},onChange:setIds}),React.createElement('input',{'aria-label':'Other field',style:{marginTop:350}}),React.createElement('output',null,ids.join(',')));}createRoot(document.getElementById('root')).render(React.createElement(Test));
</script></body></html>`);
const browser=await chromium.launch({channel:'msedge',headless:true});
try{for(const width of [1440,390]){const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('crash',()=>errors.push('Renderer crashed'));await page.goto(`http://127.0.0.1:5173/${name}`);
const trigger=page.getByRole('button',{name:/^Mechanic:/});
for(let i=0;i<20;i++){await trigger.click();await page.getByRole('checkbox',{name:'Mechanic A',exact:true}).check();await page.getByRole('checkbox',{name:'Mechanic B',exact:true}).check();assert.equal(await page.locator('output').textContent(),'a,b');await page.getByRole('checkbox',{name:'Mechanic A',exact:true}).uncheck();await page.keyboard.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);await trigger.click();await page.getByRole('checkbox',{name:'Mechanic B',exact:true}).uncheck();await page.getByLabel('Other field').click();assert.equal(await trigger.getAttribute('aria-expanded'),'false');}
await trigger.focus();await page.keyboard.press('Enter');await page.keyboard.press('Tab');await page.keyboard.press('Space');assert.equal(await page.getByRole('checkbox',{name:'Mechanic A',exact:true}).isChecked(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('body').getAttribute('data-submitted'),null);assert.deepEqual(errors,[]);console.log(`Mechanic selection and keyboard checks passed at ${width}px`);await page.close();}}
finally{await browser.close();await unlink(file);}
