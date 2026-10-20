import assert from "node:assert/strict";
import test from "node:test";
import { canViewWorkorderPrices } from "../../../../shared/workorder-pricing-access.js";
import { projectProtectedWorkorderDetail } from "./workorder-module-projection.js";

const price = { unitPrice: 75, currency: "USD" };
const detail = {
  workorder: { id: "wo-1", companyId: "company-1", formData: { laborHours: 2, parts: [{ partNo: "FILTER", qty: 1, repairOrder: "Replace filter" }] } },
  laborPrice: price,
  currentLaborRates: { selling_price: price },
  workorderPricing: { status: "complete", total: 225 },
  installedSerializedParts: [{ usageId: "serial-1", partNo: "FILTER", price, costAllocations: [{ amount: 50 }] }],
  aggregatePartUsages: [{ id: "usage-1", quantity: 1, price, costAllocations: [{ amount: 50 }] }],
  noStockPartPrices: [{ noStockLineId: "line-1", price }],
};
const decisions = { parts: { access: "read" }, diagnosisRepair: { access: "read" } };

for (const role of ["admin", "office", "surveillance", "mechanic", "kiosk", "read", undefined]) {
  test(`${role}: financial visibility follows explicit role allowlist`, () => {
    const allowed = ["admin", "office", "surveillance"].includes(role);
    assert.equal(canViewWorkorderPrices(role), allowed);
    const result = projectProtectedWorkorderDetail(detail, decisions, { viewerRole: role });
    assert.equal(Boolean(result.workorderPricing), allowed);
    assert.equal(Boolean(result.modules.diagnosisRepair.data.laborPrice), allowed);
    assert.equal(Boolean(result.modules.parts.data.installedSerializedParts[0].price), allowed);
    assert.equal(Boolean(result.modules.parts.data.aggregatePartUsages[0].costAllocations), allowed);
    assert.equal(result.modules.parts.data.noStockPartPrices.length, allowed ? 1 : 0);
    assert.equal(result.workorder.formData.parts[0].repairOrder, "Replace filter");
    assert.equal(result.workorder.formData.laborHours, 2);
    assert.equal(result.customerDocumentAccess?.canWrite || false, false);
  });
}

test("financial visibility still respects hidden modules", () => {
  const result = projectProtectedWorkorderDetail(detail, { parts: { access: "hidden" }, diagnosisRepair: { access: "hidden" } }, { viewerRole: "surveillance" });
  assert.equal(result.workorderPricing, undefined);
  assert.equal(result.installedSerializedParts, undefined);
  assert.deepEqual(result.modules, {});
});

for (const role of ["admin", "office", "surveillance", "mechanic", "kiosk", "read", undefined]) {
  test(`${role}: financial timeline follows the same role allowlist`, () => {
    const priceEvent = { type: "field", field_key: "pricing.part.aggregate.line-1", new_value: "USD 24.5678 custom price (selling price)" };
    const operationalEvent = { type: "status", to_status: "in_progress" };
    const input = { ...detail, timeline: [priceEvent, operationalEvent] };
    const projected = projectProtectedWorkorderDetail(input, { activity: { access: "read" } }, { viewerRole: role });
    const expected = ["admin", "office", "surveillance"].includes(role) ? input.timeline : [operationalEvent];
    assert.deepEqual(projected.timeline, expected);
    assert.deepEqual(projected.modules.activity.data.timeline, expected);
    assert.equal(input.timeline.length, 2);
  });
}
