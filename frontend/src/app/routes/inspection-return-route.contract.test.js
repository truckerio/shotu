import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailRoute = readFileSync(new URL("./useWorkorderDetailRoute.js", import.meta.url), "utf8");
const roleNavigation = readFileSync(new URL("./useRoleRouteNavigation.js", import.meta.url), "utf8");
const office = readFileSync(new URL("../../features/office/OfficeWorkspace.jsx", import.meta.url), "utf8");
const mechanic = readFileSync(new URL("../../features/mechanic/MechanicWorkspace.jsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../../features/admin/workspace/OperationsPage.jsx", import.meta.url), "utf8");

test("only successful workorder hydration writes inspection return context", () => {
  assert.match(detailRoute, /hydrateOfficeWorkorder\(detail, \{ partRequestId, inspectionReturn \}\)/);
  assert.match(detailRoute, /workorderDetailSearch\(workorder\.id, nextSection, \{ partRequestId, inspectionReturn \}\)/);
  assert.match(detailRoute, /workorderDetailSearch\(workorder\.id, nextSection, \{ inspectionReturn \}\)/);
});

test("ordinary app Back consumes validated inspection context and each workspace restores inspection mode", () => {
  assert.match(roleNavigation, /const inspectionReturn = inspectionReturnContext\(\)/);
  assert.match(roleNavigation, /workspaceSearchForRole\(actor\.role, \{ inspectionReturn \}\)/);
  for (const source of [office, mechanic, admin]) {
    assert.match(source, /inspectionReturnContext\(\)/);
  }
  assert.match(office, /initialInspectionId=\{createdInspectionId \|\| initialInspectionId\}/);
  assert.match(admin, /initialInspectionId=\{createdInspectionId \|\| initialInspectionId\}/);
  assert.match(mechanic, /initialInspectionId=\{initialInspectionId \|\| createdInspectionId\}/);
});

test("mechanic forwards the return context only through its normal detail hydration callback", () => {
  assert.match(mechanic, /async function openWorkorder\(id, inspectionReturn\)/);
  assert.match(mechanic, /onOpenWorkorder\(detail, \{ inspectionReturn \}\)/);
  assert.doesNotMatch(mechanic, /replaceRouteSearch/);
});
