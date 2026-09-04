import assert from "node:assert/strict";
import test from "node:test";
import { loadMechanicWorkspaceData, MECHANIC_INSPECTION_WINDOW } from "./mechanic-workspace-api.js";

test("combined mechanic loading follows the bounded cursor inspection contract", async () => {
  const requests = [];
  const result = await loadMechanicWorkspaceData(async (path) => {
    requests.push(path);
    if (path === "/api/mechanic/dashboard") return { myWork:[] };
    const url = new URL(path, "https://example.test");
    assert.ok(Number(url.searchParams.get("limit")) <= 50);
    const status = url.searchParams.get("status");
    if (!url.searchParams.get("cursor")) return { items:Array.from({ length:50 }, (_, index) => ({ id:`${status}-first-${index}` })), nextCursor:`${status}-page-2` };
    return { items:Array.from({ length:50 }, (_, index) => ({ id:`${status}-second-${index}` })), nextCursor:`${status}-page-3` };
  }, { includeInspections:true });

  assert.equal(MECHANIC_INSPECTION_WINDOW, 100);
  assert.equal(result.dashboardError, null);
  assert.equal(result.inspectionError, null);
  assert.equal(result.inspections.items.length, 200);
  assert.deepEqual(requests, [
    "/api/mechanic/dashboard",
    "/api/inspections?status=not_completed&limit=50",
    "/api/inspections?status=completed&limit=50",
    "/api/inspections?status=not_completed&limit=50&cursor=not_completed-page-2",
    "/api/inspections?status=completed&limit=50&cursor=completed-page-2",
  ]);
});

test("inspection failure does not discard a successful workorder dashboard", async () => {
  const result = await loadMechanicWorkspaceData(async (path) => {
    if (path === "/api/mechanic/dashboard") return { myWork:[{ id:"wo-1" }] };
    throw new Error("Inspection queue unavailable");
  }, { includeInspections:true });

  assert.deepEqual(result.dashboard.myWork, [{ id:"wo-1" }]);
  assert.equal(result.dashboardError, null);
  assert.equal(result.inspections, null);
  assert.match(result.inspectionError.message, /unavailable/);
});

test("dashboard failure remains visible even when inspection loading succeeds", async () => {
  const result = await loadMechanicWorkspaceData(async (path) => {
    if (path === "/api/mechanic/dashboard") throw new Error("Dashboard unavailable");
    return { items:[], nextCursor:"" };
  }, { includeInspections:true });

  assert.equal(result.dashboard, null);
  assert.match(result.dashboardError.message, /unavailable/);
  assert.deepEqual(result.inspections.items, []);
});
