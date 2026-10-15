import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeInspectionDeferral, evaluateInspectionMaintenance } from "./inspection-maintenance.js";

test("additional miles become one immutable absolute target", () => {
  assert.deepEqual(canonicalizeInspectionDeferral({ reason:"Fluid can wait", nextVisit:false, baselineMiles:249800, additionalMiles:200, earlyMiles:150 }), {
    reason:"Fluid can wait", nextVisit:false, dueDate:null, dueMiles:250000, baselineMiles:249800, additionalMiles:200, earlyMiles:150,
  });
});

test("deferral requires attention trigger compatible with unit mileage support", () => {
  assert.throws(() => canonicalizeInspectionDeferral({ reason:"Wait", nextVisit:false }), /Choose next shop visit/);
  assert.throws(() => canonicalizeInspectionDeferral({ reason:"Wait", nextVisit:false, additionalMiles:100 }), /Confirm current mileage/);
  assert.throws(() => canonicalizeInspectionDeferral({ reason:"Wait", nextVisit:false, dueMiles:1000 }, { unitType:"Trailer" }), /Trailer deferrals/);
});

test("due evaluation honors inclusive early window and actual subsequent visit", () => {
  const base={deferral:{reason:"Wait",nextVisit:true,dueMiles:250000,dueDate:null,baselineMiles:null,additionalMiles:null,earlyMiles:200},now:new Date("2026-10-14T18:00:00Z"),sourceCompletedAt:"2026-10-10T10:00:00Z"};
  assert.deepEqual(evaluateInspectionMaintenance({...base,mileage:{miles:249800,state:"fresh"}}),{dueState:"due_soon",remainingMiles:200});
  assert.equal(evaluateInspectionMaintenance({...base,mileage:{miles:249700,state:"fresh"},visitStartedAt:"2026-10-11T10:00:00Z"}).dueState,"due");
  assert.equal(evaluateInspectionMaintenance({...base,mileage:{miles:249700,state:"fresh"},visitStartedAt:"2026-10-09T10:00:00Z"}).dueState,"upcoming");
});

test("known due trigger outranks uncertain mileage and linked repair states are explicit", () => {
  const input={deferral:{reason:"Wait",nextVisit:false,dueDate:"2026-10-14",dueMiles:250000,baselineMiles:null,additionalMiles:null,earlyMiles:200},mileage:{miles:null,state:"conflict"},now:new Date("2026-10-14T20:00:00Z")};
  assert.equal(evaluateInspectionMaintenance(input).dueState,"due");
  assert.equal(evaluateInspectionMaintenance({...input,workorderStatus:"in_progress"}).dueState,"repair_planned");
  assert.equal(evaluateInspectionMaintenance({...input,workorderStatus:"closed"}).dueState,"verification_required");
  assert.equal(evaluateInspectionMaintenance({...input,deferral:{...input.deferral,dueDate:null},mileage:{miles:250001,state:"stale"}}).dueState,"overdue");
});

test("repeated next-visit deferral resets visit trigger without changing obligation age", () => {
  const value=evaluateInspectionMaintenance({deferral:{reason:"Rechecked",nextVisit:true,dueDate:null,dueMiles:null,baselineMiles:null,additionalMiles:null,earlyMiles:200,reviewedAt:"2026-10-14T12:00:00Z"},visitStartedAt:"2026-10-14T10:00:00Z",sourceCompletedAt:"2026-09-01T10:00:00Z",mileage:{miles:null,state:"unknown"}});
  assert.equal(value.dueState,"upcoming");
});
