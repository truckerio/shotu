import test from "node:test";
import assert from "node:assert/strict";
import { inspectionPreset, renderInspectionSlip, INSPECTION_ANNUAL_RENDERER_VERSION } from "./inspection-template.js";

const definition = inspectionPreset("Truck", "annual");
const base = { status:"completed", inspectionNumber:"INS-42", completedAt:"2026-10-21T16:00:00.000Z", templateSnapshot:definition, unit:{ unitNo:"T-42", vin:"VIN42", licensePlate:"CA42" }, result:"passed" };

test("annual truck and trailer starters retain all 15 paper-report sections and 56 checks", () => {
  const expected = [["brakes",13],["coupling",6],["exhaust",3],["fuel",3],["lighting",1],["loading",3],["steering",10],["suspension",3],["frame",3],["tires",3],["wheels",4],["glazing",1],["wipers",1],["seats",1],["other",1]];
  for (const unitType of ["Truck", "Trailer"]) {
    const preset = inspectionPreset(unitType,"annual");
    assert.deepEqual(preset.sections.map(section=>[section.key,section.items.length]),expected);
    assert.equal(preset.rendererVersion,INSPECTION_ANNUAL_RENDERER_VERSION);
    assert.equal(preset.printLayout,"annual_report");
    assert.ok(preset.sections.flatMap(section=>section.items).every(item=>item.allowNa));
  }
});

test("annual report prints every check exactly once and maps only recorded results", () => {
  const html=renderInspectionSlip({...base,responses:[{id:"a",itemKey:"brakes-1",response:"pass"},{id:"b",itemKey:"brakes-2",response:"issue"},{id:"c",itemKey:"coupling-1",response:"na",naReason:"Not fitted"}],findings:[{responseId:"b",severity:"repair_required",note:"Repair parking brake",disposition:"new_workorder"}]});
  assert.equal((html.match(/class="check"/g)||[]).length,56);
  assert.equal((html.match(/<table class="component-table">/g)||[]).length,3);
  assert.match(html,/data-item="brakes-1"><td>X<\/td><td><\/td><td><\/td><td><\/td>/);
  assert.match(html,/data-item="brakes-2"><td><\/td><td>X<\/td><td><\/td><td><\/td>/);
  assert.match(html,/data-item="coupling-1"><td><\/td><td><\/td><td>X<\/td><td><\/td>/);
  assert.match(html,/data-item="brakes-3"><td><\/td><td><\/td><td><\/td><td><\/td>/);
  for(const item of definition.sections.flatMap(section=>section.items)) assert.equal(html.split(`data-item="${item.key}"`).length-1,1);
  assert.match(html,/Repair parking brake/);assert.match(html,/Not fitted/);
  assert.match(html,/VIN42/);assert.match(html,/CA42/);assert.match(html,/2026-10-21/);
  assert.doesNotMatch(html,/vehicle has passed all|meets the qualification|DOT.certified/i);
});

test("report escapes notes and preserves correction lineage and out-of-service result", () => {
  const html=renderInspectionSlip({...base,result:"out_of_service",inspectionNumber:'<script>bad</script>',finalNotes:'Long <unsafe> & note',lineageKind:"correction",revisionNumber:2,predecessorInspectionNumber:"INS-41",revisionReason:"Corrected <notes>"});
  assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;unsafe&gt; &amp; note/);assert.match(html,/CORRECTION - REVISION 2/);assert.match(html,/INS-41/);assert.match(html,/Out of service/);
  assert.match(html,/\[ \] Yes/);assert.doesNotMatch(html,/\[X\] Yes/);
});

test("legacy annual definition without layout keeps standard renderer and pending preview stays pending", () => {
  const legacy={...definition,rendererVersion:"inspection-slip-v1"};delete legacy.printLayout;
  const html=renderInspectionSlip({...base,templateSnapshot:legacy});
  assert.doesNotMatch(html,/class="annual-report"/);assert.match(html,/<th>Check<\/th><th>Result<\/th><th>Details<\/th>/);
  const pending=renderInspectionSlip({...base,status:"in_progress",result:null,responses:[]});
  assert.match(pending,/IN PROGRESS - NOT A COMPLETED INSPECTION/);assert.match(pending,/Checklist result<\/span><strong>Pending/);
  assert.doesNotMatch(pending,/<td>X<\/td>/);
});

test("annual report retains deferred maintenance reason and all review triggers", () => {
  const html=renderInspectionSlip({...base,responses:[{id:"response",itemKey:"brakes-1",response:"issue"}],findings:[{responseId:"response",severity:"attention",note:"Review fitting",disposition:"defer",deferral:{reason:"Review <cover> later",nextVisit:true,dueDate:"2026-11-01",dueMiles:250000,earlyMiles:200}}]});
  assert.match(html,/Deferred: Review &lt;cover&gt; later/);
  assert.match(html,/Next shop visit; By 2026-11-01; At 250000 mi; whichever comes first/);
  assert.match(html,/Early notice: 200 mi/);
});


test("annual identity prints captured carrier address and assigned inspector without guessing missing values", () => {
  const html = renderInspectionSlip({...base, unit:{...base.unit, reportCarrier:{name:'Carrier <North>', address:'123 Main St\nFresno, CA 93722'}}, inspector:{id:'assigned',name:'Mechanic & Inspector'}, inspectionLocation:{name:'Main shop'}});
  assert.match(html,/Carrier &lt;North&gt;/);
  assert.match(html,/123 Main St\nFresno, CA 93722/);
  assert.match(html,/Mechanic &amp; Inspector/);
  assert.match(html,/Main shop/);
  assert.match(html,/Address \/ city, state, ZIP/);
  const blank = renderInspectionSlip({...base, mechanic:{name:'Live profile must not be used'}, customer:{name:'Live customer must not be used'}});
  assert.doesNotMatch(blank,/Live profile|Live customer/);
});
