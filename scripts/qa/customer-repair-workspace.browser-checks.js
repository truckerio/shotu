import assert from 'node:assert/strict';
export async function checkRepairLinkControls(tab,{observe=async()=>{}}={}){
 const page=tab.playwright;
 await page.getByRole('tab',{name:'Documents',exact:true}).click();await observe();
 await page.getByRole('button',{name:'Print',exact:true}).waitFor({state:'visible'});
 assert.equal(await page.getByRole('button',{name:'Download PDF',exact:true}).isEnabled(),true);
 const preview=page.getByRole('region',{name:'Document preview',exact:true});
 const card=await page.locator('.workorder-customer-documents article.customer-document').evaluate(el=>({border:getComputedStyle(el).borderTopWidth,padding:getComputedStyle(el).paddingTop}));
 assert.notEqual(card.border,'0px');assert.ok(parseFloat(card.padding)>=16);
 assert.ok((await preview.innerText()).includes('LABOUR'),'Estimate renders labour lines');
 await page.getByRole('button',{name:'Customer link',exact:true}).click();await observe();
 const open=page.getByRole('link',{name:'Open customer view',exact:true});await open.waitFor({state:'visible'});
 assert.equal(await page.getByRole('textbox',{name:'Customer email',exact:true}).isVisible(),true);
 const href=await open.getAttribute('href');assert.match(href,/#customerRepair=[A-Za-z0-9_-]{43}$/);
 await checkRepairLinkReopen(tab,{observe});
 return {href,card};
}
export async function checkCustomerRepairPortal(tab,{observe=async()=>{}}={}) {
 const page=tab.playwright;
 const navigation=page.getByRole('navigation',{name:'Repair navigation',exact:true});
 await navigation.waitFor({state:'visible'});
 const fragment=await page.evaluate(()=>location.hash);
 const repair= navigation.getByRole('button',{name:'Repair',exact:true});
 const chat= navigation.getByRole('button',{name:'Chat',exact:true});
 await repair.click();await observe();
 await page.getByRole('region',{name:'Vehicle status',exact:true}).waitFor({state:'visible'});
 assert.equal(await page.locator('.customer-document').isVisible(),false,'Repair home does not expand the whole document');
 assert.equal(await page.getByRole('textbox',{name:'Message to shop',exact:true}).isVisible(),false,'Chat is a separate screen');
 const geometry=await page.getByRole('region',{name:'Repair documents',exact:true}).evaluate(el=>({width:innerWidth,right:el.getBoundingClientRect().right,horizontal:document.documentElement.scrollWidth>innerWidth}));
 assert.equal(geometry.horizontal,false);assert.ok(geometry.right<=geometry.width+1);
 await page.getByRole('button',{name:'View estimate',exact:true}).click();await observe();
 const preview=page.getByRole('region',{name:'Document preview',exact:true});await preview.waitFor({state:'visible'});
 assert.ok((await preview.innerText()).includes('LABOUR'));
 assert.equal(await page.getByRole('button',{name:'Download PDF',exact:true}).isVisible(),true);
 const notes=page.locator('.customer-document-notes');
 if(await notes.count())assert.equal(await notes.evaluate(el=>el.querySelectorAll('h2').length),0);
 await page.getByRole('button',{name:'Back to repair',exact:true}).click();await chat.click();await observe();
 assert.equal(await preview.isVisible(),false,'Document is not on the Chat screen');
 const draft=page.getByRole('textbox',{name:'Message to shop',exact:true});await draft.waitFor({state:'visible'});
 const old=await draft.evaluate(el=>el.value);await draft.fill('Repair portal retained draft');
 const name=page.getByRole('textbox',{name:'Your name',exact:true});const oldName=await name.evaluate(el=>el.value);await name.fill('Mobile QA');
 await repair.click();await chat.click();await observe();
 assert.equal(await draft.evaluate(el=>el.value),'Repair portal retained draft');assert.equal(await name.evaluate(el=>el.value),'Mobile QA');
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await observe();assert.equal(await draft.evaluate(el=>el.value),'Repair portal retained draft');
 const chatGeometry=await draft.evaluate(el=>({bottom:el.getBoundingClientRect().bottom,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,pageHeight:document.documentElement.scrollHeight}));
 assert.equal(chatGeometry.overflow,false);assert.ok(chatGeometry.pageHeight<=chatGeometry.height+1,'Chat uses the viewport rather than a second page scroll');assert.ok(chatGeometry.bottom<=chatGeometry.height+1,'Composer visible without scrolling through the repair');
 const targets=await navigation.locator('button').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().height));for(const height of targets)assert.ok(height>=43.5);
 assert.equal(await page.evaluate(()=>location.hash),fragment,'Navigation never replaces the capability fragment');
 await draft.fill(old);await name.fill(oldName);
 if(tab.back)await tab.back();else await page.goBack();await observe();
 assert.equal(await repair.getAttribute('aria-current'),'page','Browser Back restores Repair');
 if(tab.forward)await tab.forward();else await page.goForward();await observe();
 await draft.waitFor({state:'visible'});
 if(tab.reload)await tab.reload();else await page.reload();await observe();
 await draft.waitFor({state:'visible'});assert.equal(await chat.getAttribute('aria-current'),'page','Refreshing Chat keeps the destination');
 assert.equal(await page.evaluate(()=>location.hash),fragment);
 await repair.click();await observe();
 return {screens:'separate',drafts:'preserved',history:'back/forward/reload',geometry,chatGeometry};
}

export async function checkRepairLinkReopen(tab,{observe=async()=>{}}={}){const page=tab.playwright;const open=page.getByRole('link',{name:'Open customer view',exact:true});const before=await open.getAttribute('href');await page.getByRole('button',{name:'Close customer link options',exact:true}).click();await page.getByRole('button',{name:'Customer link',exact:true}).click();await observe();assert.equal(await open.getAttribute('href'),before);assert.doesNotMatch(await page.getByRole('region',{name:'Customer repair link',exact:true}).innerText(),/secret is no longer available|Create a new link to continue/);return{reopened:'same link'};}
export async function checkEstimateEditorClosed(tab){await tab.playwright.getByRole('region',{name:'Update estimate',exact:true}).waitFor({state:'hidden'});assert.equal(await tab.playwright.getByRole('region',{name:'Update estimate',exact:true}).count(),0,'Revision controls close after successful issue');return{revisionEditor:'closed'};}
export async function issueEstimateRevisionForCheck(tab,{observe=async()=>{}}={}){const page=tab.playwright;const text=await page.locator('.workorder-customer-documents .customer-document h1').innerText();const next=Number(text.match(/R(\d+)/)?.[1]||0)+1;await page.getByRole('button',{name:'More document options',exact:true}).click();await page.getByRole('menuitem',{name:'Update estimate',exact:true}).click();await page.getByRole('button',{name:'Review revised Estimate',exact:true}).click();await page.getByRole('button',{name:'Issue revised Estimate',exact:true}).waitFor({state:'visible'});await page.getByRole('button',{name:'Issue revised Estimate',exact:true}).click();await page.getByRole('heading',{name:new RegExp(`R${next}$`)}).waitFor({state:'visible'});await observe();return checkEstimateEditorClosed(tab);}
export async function checkDocumentMenuInDialog(tab,{observe=async()=>{}}={}){const page=tab.playwright;await page.getByRole('button',{name:'More document options',exact:true}).click();await observe();const menu=page.locator('.workorder-document-menu');await menu.waitFor({state:'visible'});assert.equal(await menu.evaluate(el=>Boolean(el.closest('dialog'))),true,'Document menu must stay inside native Tools dialog');await menu.press('Escape');await observe();return{compactDocumentMenu:'contained'};}
