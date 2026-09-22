// Run with: node scripts/qa/safari-controls.browser.js
// Local component fixture only: no hosted records or API mutations.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { webkit } from "playwright";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixturePath = path.join(root, "frontend/__safari-controls-fixture.jsx");
const fixture = `
import React, { useState } from 'react';
import '/src/styles/foundation.css';
import '/src/typography.css';
import { createRoot } from 'react-dom/client';
import { CreateAssignmentModule } from '/src/features/workorder-modules/assignment/CreateAssignmentModule.jsx';
import { WorkorderAssignmentModule } from '/src/features/workorder-modules/assignment/WorkorderAssignmentModule.jsx';
import { CreateScheduleModule } from '/src/features/workorder-modules/schedule/CreateScheduleModule.jsx';
import { FormField } from '/src/components/forms/FormField.jsx';
import { DatePicker } from '/src/components/forms/DatePicker.jsx';
const mechanics = [{id:'one',name:'First mechanic'},{id:'two',name:'Second mechanic'}];
function Fixture() {
 const [selected,setSelected] = useState(['one']);
 const [assignment,setAssignment] = useState({mechanicUserIds:['one'],reason:''});
 const [saved,setSaved] = useState('');
 const [date,setDate] = useState('2026-09-11');
 const [optional,setOptional] = useState('2026-09-12');
 const [required,setRequired] = useState('');
 const [submits,setSubmits] = useState(0);
 return <main style={{maxWidth:700,padding:24}}>
 <section data-testid="create"><CreateAssignmentModule access="write" activeSection="assignment" presentation="one-page" assignment={{mechanics,mechanicUserIds:selected}} onChange={setSelected}/><output>{selected.join(',')}</output></section>
 <section data-testid="detail" style={{marginTop:360}}><WorkorderAssignmentModule access="write" activeSection="assignment" presentation="one-page" allowedActions={{assignMechanics:true}} assignment={assignment} assignableMechanics={mechanics} assignedIds={assignment.mechanicUserIds} onAssignmentChange={setAssignment} assignmentChanged={true} onSave={()=>setSaved(assignment.mechanicUserIds.join(','))}/><output>{assignment.mechanicUserIds.join(',')}</output></section>
 <output data-testid="saved">{saved}</output>
 <section data-testid="dates" style={{marginTop:360}}>
  <DatePicker aria-label="Work start date" name="workStartDate" value={date} min="2026-09-10" max="2026-09-20" onChange={e=>setDate(e.target.value)}/><output data-testid="date-value">{date}</output>
  <DatePicker aria-label="Optional date" value={optional} onChange={e=>setOptional(e.target.value)}/><output data-testid="optional-value">{optional}</output>
  <DatePicker aria-label="Disabled date" value="2026-09-11" disabled/>
  <form onSubmit={e=>{e.preventDefault();setSubmits(x=>x+1)}}><DatePicker aria-label="Required date" name="requiredDate" value={required} required onChange={e=>setRequired(e.target.value)}/><button>Submit date</button></form><output data-testid="submits">{submits}</output>
 </section>
 <FormField id="linked-date" label="Linked date"><DatePicker aria-label="Linked date" value={date} onChange={e=>setDate(e.target.value)}/></FormField>
 <section data-testid="schedule" className="control-panel" data-workorder-presentation="one-page" style={{width:220,marginTop:30}}><CreateScheduleModule access="write" activeSection="schedule" presentation="one-page" form={{workStartDate:date,workEndDate:optional}} onChange={()=>{}}/></section>
 <button id="outside" style={{marginTop:360}}>Outside</button>
 </main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
const server = await createServer({
 configFile: path.join(root, "frontend/vite.config.js"),
 server: { host: "127.0.0.1", port: 0, open: false },
 plugins: [{ name: "safari-controls-fixture", resolveId(id) { if (id === "/__safari-controls-fixture.jsx") return fixturePath; }, load(id) { if (id === fixturePath) return fixture; } }],
});
let browser;
try {
 await server.listen();
 browser = await webkit.launch();
 const page = await browser.newPage({viewport:{width:1024,height:900}});
 const errors = [];
 page.on("pageerror", (error) => errors.push(error.message));
 await page.route("**/__safari-controls", async (route) => route.fulfill({contentType:"text/html",body:await server.transformIndexHtml("/__safari-controls",'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__safari-controls-fixture.jsx"></script></body></html>')}));
 await page.goto(`${server.resolvedUrls.local[0]}__safari-controls`);
 for (const name of ["create", "detail"]) {
  const scope = page.getByTestId(name);
  const menu = scope.locator("details");
  const summary = menu.locator("summary");
  await summary.click();
  // Reproduce Safari's null-relatedTarget blur before checkbox activation.
  await summary.focus();
  await summary.evaluate((element) => element.dispatchEvent(new FocusEvent("focusout", {bubbles:true, relatedTarget:null})));
  assert.equal(await menu.getAttribute("open"), "", `${name}: null blur must keep menu open`);
  await scope.getByText("Second mechanic",{exact:true}).click();
  assert.equal(await scope.getByRole("checkbox",{name:"Second mechanic"}).isChecked(),true);
  assert.equal(await menu.getAttribute("open"), "", `${name}: selection keeps menu open`);
  assert.equal(await scope.locator("output").textContent(),"one,two");
  await scope.getByRole("checkbox",{name:"First mechanic"}).click();
  assert.equal(await scope.locator("output").textContent(),"two");
  const checkbox = scope.getByRole("checkbox",{name:"First mechanic"});
  await checkbox.focus();
  await page.keyboard.press("Space");
  assert.equal(await checkbox.isChecked(),true);
  if (name === "detail") {
   await scope.getByRole("button",{name:"Update team"}).click();
   assert.equal(await page.getByTestId("saved").textContent(),"two,one");
  }
  await checkbox.focus();
  await page.keyboard.press("Escape");
  assert.equal(await menu.getAttribute("open"),null);
  assert.equal(await summary.evaluate((element)=>document.activeElement===element),true);
  await summary.click();
  await page.locator("#outside").click();
  assert.equal(await menu.getAttribute("open"),null);
  await summary.click();
  await page.locator("#outside").focus();
  assert.equal(await menu.getAttribute("open"),null);
  console.log(`PASS ${name}: label, checkbox, keyboard, null blur, Escape, outside pointer/focus${name==='detail'?', save callback':''}`);
 }
 const dates = page.getByTestId("dates");
 await dates.getByRole("button",{name:"Open calendar for Work start date"}).click();
 const calendar = page.getByRole("dialog",{name:"Work start date calendar"});
 await calendar.getByRole("button",{name:/September 15, 2026/}).click();
 assert.equal(await page.getByTestId("date-value").textContent(),"2026-09-15");
 await dates.getByRole("button",{name:"Open calendar for Work start date"}).click();
 assert.equal(await calendar.getByRole("button",{name:/September 9, 2026/}).getAttribute("aria-disabled"),"true");
 assert.equal(await calendar.getByRole("button",{name:/September 21, 2026/}).getAttribute("aria-disabled"),"true");
 await calendar.getByRole("button",{name:/September 15, 2026/}).focus();
 await page.keyboard.press("Escape");
 await calendar.waitFor({state:"hidden"});
 assert.equal(await dates.getByRole("button",{name:"Open calendar for Disabled date"}).isDisabled(),true);
 await dates.getByRole("button",{name:"Submit date"}).click();
 assert.equal(await page.getByTestId("submits").textContent(),"0");
 await dates.getByRole("button",{name:"Open calendar for Optional date"}).click();
 const optionalCalendar = page.getByRole("dialog",{name:"Optional date calendar"});
 await optionalCalendar.getByRole("button",{name:"Next month"}).click();
 await optionalCalendar.getByRole("button",{name:/October 5, 2026/}).click();
 assert.equal(await page.getByTestId("optional-value").textContent(),"2026-10-05");
 const optionalGroup = dates.locator('.date-picker').filter({has:page.getByRole('button',{name:'Open calendar for Optional date'})});
 const optionalDay = optionalGroup.locator('[data-type="day"]');
 await optionalDay.focus();
 await page.keyboard.press('ArrowUp');
 assert.equal(await page.getByTestId('optional-value').textContent(),'2026-10-06');
 await dates.getByRole("button",{name:"Open calendar for Optional date"}).click();
 await page.getByRole("button",{name:"Clear date",exact:true}).click();
 assert.equal(await page.getByTestId('optional-value').textContent(),'');
 await optionalCalendar.waitFor({state:"hidden"});
 console.log("PASS calendar: keyboard edit and clearing optional date");
 console.log("PASS calendar: app popup, ISO value, min/max, disabled, required, month navigation, Escape");
 for (const width of [375,768]) {
  await page.setViewportSize({width,height:900});
  await dates.getByRole("button",{name:"Open calendar for Work start date"}).click();
  const box = await calendar.boundingBox();
  assert.ok(box && box.x >= 0 && box.x+box.width <= width, `calendar fits ${width}px viewport`);
  await calendar.getByRole("button",{name:/September 15, 2026/}).focus();
  await page.keyboard.press("Escape");
  await calendar.waitFor({state:"hidden"});
 }
 console.log("PASS calendar: phone and tablet popup fit");
 const schedule = page.getByTestId("schedule");
 for (const width of [220,320]) {
  await schedule.evaluate((element,width)=>element.style.width=width+'px',width);
  for (const picker of await schedule.locator('.date-picker').all()) {
   const lastSegment = await picker.locator('[data-type="year"]').boundingBox();
   const icon = await picker.locator('.date-picker-trigger').boundingBox();
   assert.ok(lastSegment.x + lastSegment.width <= icon.x + 1, `date text does not overlap icon in ${width}px range`);
  }
 }
 console.log("PASS calendar: compact workorder date range text and icons do not overlap");
 await page.locator('label[for="linked-date"]').click();
 const linkedCalendar = page.getByRole('dialog',{name:'Linked date calendar'});
 await linkedCalendar.waitFor({state:'visible'});
 await linkedCalendar.getByRole('button',{name:/September 15, 2026/}).focus();
 await page.keyboard.press('Escape');
 await linkedCalendar.waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.getElementById('linked-date').closest('.date-picker').contains(document.activeElement));
 console.log('PASS calendar: FormField label opens picker and dismissal restores control focus');
 assert.deepEqual(errors,[]);
} finally {
 await browser?.close();
 await server.close();
}
