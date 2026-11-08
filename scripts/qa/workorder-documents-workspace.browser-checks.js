import assert from 'node:assert/strict';

// Browser API adapter: CUA passes a tab; CI passes {playwright: page}.
export async function checkWorkorderDocumentsWorkspace(tab,{observe=async()=>{}}={}) {
 const page=tab.playwright;
 const opener=page.getByRole('button',{name:'Open workorder tools',exact:true});
 if(!await page.getByRole('button',{name:'Close workorder tools',exact:true}).isVisible()) { await opener.waitFor({state:'visible'}); await opener.click(); }
 await page.getByRole('tab',{name:'Documents',exact:true}).click();await observe();
 const documents=page.getByRole('region',{name:'Document preview',exact:true});
 await documents.waitFor({state:'visible'});
 const text=await page.locator('.workorder-customer-documents').innerText();
 assert.ok(!/Customer messages|Internal cost and inventory|Available after Work done|Customer documents/.test(text),'Documents has one preview and no duplicated explanatory blocks or chat');
 assert.equal(await page.getByRole('button',{name:'Invoice',exact:true}).count(),0,'Invoice selection appears only after issue');
 const box=await documents.evaluate(el=>({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,height:innerHeight,overflow:getComputedStyle(el).overflowY}));
 assert.ok(box.top>=0&&box.bottom<=box.height+1,`Document remains inside viewport: ${JSON.stringify(box)}`);assert.equal(box.overflow,'auto');
 const chatResult=await checkWorkorderChatWorkspace(tab,{observe});
 return {documentGeometry:box,...chatResult};
}

export async function checkWorkorderChatWorkspace(tab,{observe=async()=>{}}={}) {
 const page=tab.playwright;
 await page.getByRole('tab',{name:'Chat',exact:true}).click();await observe();
 await page.getByRole('tab',{name:'Internal',exact:true}).click();await observe();
 const internal=page.locator('.workorder-chat-workspace [data-audience="internal"] textarea');
 assert.equal(await page.locator('[data-audience="internal"] .chat-prompt-surface').count(),1,'Internal uses the shared composer');
 assert.equal(await page.locator('[data-audience="internal"] .chat-thread').count(),1,'Internal uses the shared thread');
 await internal.waitFor({state:'visible'});const oldInternal=await internal.evaluate(el=>el.value);await internal.fill('Private regression draft');
 await page.getByRole('tab',{name:'Customer',exact:true}).click();await observe();
 const customer=page.getByRole('textbox',{name:'Message to customer',exact:true});await customer.waitFor({state:'visible'});
 assert.equal(await page.locator('[data-audience="customer"] .chat-prompt-surface').count(),1,'Customer uses the shared composer');
 assert.equal(await page.locator('[data-audience="customer"] .chat-thread').count(),1,'Customer uses the shared thread');
 assert.equal(await page.locator('[data-audience="customer"] input[type=file]').count(),0,'Customer remains text-only');
 assert.equal(await customer.evaluate(el=>el.maxLength),5000);
 const oldCustomer=await customer.evaluate(el=>el.value);await customer.fill('Customer regression draft');
 assert.ok((await page.getByRole('region',{name:'Customer chat',exact:true}).innerText()).includes('Visible to customer'));
 assert.equal(await internal.isVisible(),false,'Internal composer is hidden from customer audience');
 await page.getByRole('tab',{name:'Documents',exact:true}).click();await observe();assert.equal(await customer.isVisible(),false,'Customer composer is absent from Documents');
 await page.getByRole('tab',{name:'Chat',exact:true}).click();await observe();assert.equal(await customer.evaluate(el=>el.value),'Customer regression draft');
 await page.getByRole('tab',{name:'Internal',exact:true}).click();await observe();assert.equal(await internal.evaluate(el=>el.value),'Private regression draft');await internal.fill(oldInternal);
 await page.getByRole('tab',{name:'Customer',exact:true}).click();await observe();await customer.fill(oldCustomer);
 await page.getByRole('tab',{name:'Documents',exact:true}).click();await observe();
 return {audienceDrafts:'preserved',customerChatInDocuments:false,sharedChatUi:true};
}
