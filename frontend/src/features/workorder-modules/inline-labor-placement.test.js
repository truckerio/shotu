import assert from "node:assert/strict";
import test from "node:test";
import { inlineLaborPlacement } from "./inline-labor-placement.js";

test("labor stays inline in Parts when readable without a duplicate repair placement", () => {
  assert.equal(inlineLaborPlacement([{ id: "parts", access: "read" }, { id: "diagnosisRepair", access: "write" }]), "parts");
});
test("hidden or scanner-only Parts retains authorized labor under repair", () => {
  for (const access of ["hidden", undefined]) assert.equal(inlineLaborPlacement([{ id: "parts", access }, { id: "diagnosisRepair", access: "write" }]), "diagnosisRepair");
  assert.equal(inlineLaborPlacement([{ id: "diagnosisRepair", access: "read" }]), "diagnosisRepair");
});
test("no readable labor host fails closed", () => {
  assert.equal(inlineLaborPlacement([{ id: "parts", access: "hidden" }, { id: "diagnosisRepair", access: "hidden" }]), null);
  assert.equal(inlineLaborPlacement([{ id: "parts", access: "read" }, { id: "diagnosisRepair", access: "hidden" }]), null);
  assert.equal(inlineLaborPlacement([{ id: "parts", access: "read" }]), null);
  assert.equal(inlineLaborPlacement(), null);
});
