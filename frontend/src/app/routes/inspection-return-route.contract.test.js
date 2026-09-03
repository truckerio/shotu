import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailRoute = readFileSync(new URL("./useWorkorderDetailRoute.js", import.meta.url), "utf8");
const roleNavigation = readFileSync(new URL("./useRoleRouteNavigation.js", import.meta.url), "utf8");
const office = readFileSync(new URL("../../features/office/OfficeWorkspace.jsx", import.meta.url), "utf8");
const mechanic = readFileSync(new URL("../../features/mechanic/MechanicWorkspace.jsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../../features/admin/workspace/OperationsPage.jsx", import.meta.url), "utf8");
const workorderDetail = readFileSync(new URL("../../features/workorder-detail/WorkorderDetailPage.jsx", import.meta.url), "utf8");
const previewController = readFileSync(new URL("../../features/workorder-detail/useWorkorderPreviewController.js", import.meta.url), "utf8");

test("every workorder section change preserves inspection context", () => {
  assert.match(previewController, /const inspectionReturn = inspectionReturnContext\(\)/);
  for (const section of ['"preview"', '"chat"', "section"]) {
    assert.ok(previewController.includes(`workorderDetailSearch(workorderId, ${section}, { inspectionReturn })`));
  }
});

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
    assert.match(source, /const initialInspectionId = inspectionAccess\.canRead \? inspectionReturn\?\.inspectionId \|\| "" : ""/);
    assert.doesNotMatch(source, /const initialInspectionId = inspectionAccess\.canRead && workorderAccess\.canRead/);
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

test("workorder detail back action preserves and labels an inspection return", () => {
  assert.match(workorderDetail, /const inspectionReturn = inspectionReturnContext\(url\.searchParams\)/);
  assert.match(workorderDetail, /workspaceSearchForRole\(actorRole, \{ inspectionReturn \}\)/);
  assert.match(workorderDetail, /label: inspectionReturn \? "Inspection"/);
});
